---
title: "Kafka를 주문/상품/결제 시스템에 직접 연결해보기"
description: "MSA 기반 주문 시스템에 Kafka를 도입한 과정 — 기술 선택 이유, 토픽 설계, 구현, 그리고 실제 마주친 문제들"
pubDate: 2026-04-02
category: "devops"
tags: ["Kafka", "Spring Boot", "Java", "MSA"]
---

## 왜 Kafka를 도입했나

처음에는 주문 서비스가 결제 서비스를 **REST로 직접 호출**하는 구조였습니다.

```
주문 서비스 ──HTTP POST──→ 결제 서비스
주문 서비스 ──HTTP PUT───→ 상품 서비스 (재고 차감)
```

이 구조가 점점 문제가 됩니다.

- **결제 서비스가 죽으면** 주문도 실패합니다. 서비스 하나의 장애가 전체에 전파됩니다.
- **주문 서비스가 결제/상품 서비스를 모두 알아야** 합니다. 서비스가 늘수록 의존성이 폭발합니다.
- **재고 차감 → 결제 → 주문 완료** 흐름에서 중간에 실패하면 정합성이 깨집니다.

Kafka를 도입한 이유는 단순합니다. **서비스 간 결합도를 끊고, 각 서비스가 독립적으로 동작**하게 만들기 위해서입니다.

### RabbitMQ가 아닌 Kafka를 선택한 이유

| 비교 항목 | RabbitMQ | Kafka |
|-----------|----------|-------|
| 메시지 보관 | 소비 후 삭제 | 디스크에 보관 (재처리 가능) |
| 처리량 | 중간 | 매우 높음 |
| 순서 보장 | 큐 단위 | 파티션 단위 |
| 실패 재처리 | 별도 설정 필요 | Offset으로 자연스럽게 가능 |

주문 이벤트는 나중에 정산, 통계, 알림 등 여러 서비스에서 **재소비**될 가능성이 높았습니다. 메시지가 소비 후 사라지는 RabbitMQ보다 Kafka가 맞는 선택이었습니다.

---

## 시스템 구조

```
[주문 서비스]
    │  order-created 이벤트 발행
    ▼
[Kafka]
    ├──→ [결제 서비스]  ─→ payment-result 이벤트 발행
    └──→ [상품 서비스]  (재고 예약)

[주문 서비스]
    ◀── payment-result 이벤트 수신
    └── 주문 상태 업데이트 (CONFIRMED / CANCELLED)
```

### 토픽 설계

```
order-created      # 주문 생성 이벤트
payment-result     # 결제 성공/실패 이벤트
inventory-reserved # 재고 예약 이벤트
order-dlq          # 처리 실패 메시지 격리
```

파티션 수는 처음엔 3개로 시작했습니다. 컨슈머 그룹의 병렬 처리 수와 맞추는 것이 기본입니다.

---

## Docker Compose 설정

로컬 개발 환경은 docker-compose로 구성했습니다.

```yaml
version: '3.8'
services:
  zookeeper:
    image: confluentinc/cp-zookeeper:7.5.0
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181

  kafka:
    image: confluentinc/cp-kafka:7.5.0
    depends_on: [zookeeper]
    ports:
      - "9092:9092"
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false"
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
```

---

## Spring Boot 설정

```yaml
# application.yml
spring:
  kafka:
    bootstrap-servers: localhost:9092
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
      acks: all          # 모든 ISR이 받아야 성공으로 간주
      retries: 3
    consumer:
      group-id: order-service
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.springframework.kafka.support.serializer.JsonDeserializer
      auto-offset-reset: earliest
      enable-auto-commit: false  # 수동 커밋 (처리 완료 후 커밋)
```

`enable-auto-commit: false`가 중요합니다. 자동 커밋을 쓰면 메시지를 받자마자 커밋되는데, 처리 도중 실패해도 메시지가 소비된 것으로 기록됩니다.

---

## 이벤트 발행 (Producer)

주문 생성 시 이벤트를 발행합니다.

```java
@Service
@RequiredArgsConstructor
public class OrderEventPublisher {

    private final KafkaTemplate<String, OrderCreatedEvent> kafkaTemplate;

    public void publishOrderCreated(Order order) {
        OrderCreatedEvent event = OrderCreatedEvent.builder()
            .orderId(order.getId())
            .memberId(order.getMemberId())
            .productId(order.getProductId())
            .quantity(order.getQuantity())
            .totalAmount(order.getTotalAmount())
            .build();

        // Key를 orderId로 설정 → 같은 주문 이벤트는 같은 파티션으로
        kafkaTemplate.send("order-created", order.getId().toString(), event)
            .whenComplete((result, ex) -> {
                if (ex != null) {
                    log.error("주문 이벤트 발행 실패: orderId={}", order.getId(), ex);
                    // 발행 실패 → DB에 PENDING 상태로 저장 (Outbox 패턴)
                }
            });
    }
}
```

`Key = orderId`로 설정한 이유는 **같은 주문에 대한 이벤트가 항상 같은 파티션**으로 가야 순서가 보장되기 때문입니다.

---

## 이벤트 수신 (Consumer)

결제 서비스에서 주문 이벤트를 받아 처리합니다.

```java
@Component
@RequiredArgsConstructor
public class OrderEventConsumer {

    private final PaymentService paymentService;

    @KafkaListener(
        topics = "order-created",
        groupId = "payment-service",
        containerFactory = "kafkaListenerContainerFactory"
    )
    public void handleOrderCreated(
        @Payload OrderCreatedEvent event,
        Acknowledgment ack
    ) {
        try {
            paymentService.processPayment(event);
            ack.acknowledge(); // 처리 성공 후 수동 커밋
        } catch (Exception e) {
            log.error("결제 처리 실패: orderId={}", event.getOrderId(), e);
            // 커밋하지 않으면 재시도됨
            throw e; // DLQ로 이동하도록 예외 전파
        }
    }
}
```

---

## 고려한 점들

### 1. 멱등성 (Idempotency)

네트워크 오류로 같은 이벤트가 두 번 발행될 수 있습니다. 결제가 두 번 처리되면 안 됩니다.

```java
@Service
public class PaymentService {

    public void processPayment(OrderCreatedEvent event) {
        // 이미 처리된 주문인지 확인
        if (paymentRepository.existsByOrderId(event.getOrderId())) {
            log.warn("이미 처리된 주문: orderId={}", event.getOrderId());
            return; // 중복 처리 방지
        }
        // 결제 진행
    }
}
```

DB에 `orderId`로 유니크 제약을 걸어두면 더 안전합니다.

### 2. 트랜잭션 문제 (Outbox Pattern)

"DB에 주문을 저장하고, Kafka에 이벤트를 발행"하는 두 작업이 **원자적으로 처리되지 않는다**는 게 가장 큰 고민이었습니다.

```
1. DB 저장 성공
2. Kafka 발행 실패  ← 이 상황에서 데이터 불일치 발생
```

이를 해결하기 위해 **Transactional Outbox 패턴**을 도입했습니다.

```java
@Transactional
public void createOrder(OrderRequest request) {
    Order order = orderRepository.save(Order.from(request));

    // Kafka에 바로 보내지 않고 outbox 테이블에 저장
    OutboxEvent outbox = OutboxEvent.builder()
        .aggregateId(order.getId().toString())
        .topic("order-created")
        .payload(toJson(OrderCreatedEvent.from(order)))
        .status(OutboxStatus.PENDING)
        .build();
    outboxRepository.save(outbox);
}
```

별도 스케줄러가 `PENDING` 이벤트를 읽어서 Kafka에 발행하고 `PROCESSED`로 업데이트합니다. DB 트랜잭션 안에서 모두 처리되므로 정합성이 보장됩니다.

### 3. DLQ (Dead Letter Queue)

처리에 계속 실패하는 메시지가 컨슈머를 막는 상황을 방지했습니다.

```java
@Bean
public DefaultErrorHandler errorHandler(KafkaTemplate<String, Object> template) {
    DeadLetterPublishingRecoverer recoverer =
        new DeadLetterPublishingRecoverer(template,
            (record, ex) -> new TopicPartition("order-dlq", record.partition())
        );

    // 3초 간격으로 3회 재시도 후 DLQ로 이동
    ExponentialBackOffWithMaxRetries backOff = new ExponentialBackOffWithMaxRetries(3);
    backOff.setInitialInterval(3_000L);
    backOff.setMultiplier(2.0);

    return new DefaultErrorHandler(recoverer, backOff);
}
```

DLQ에 쌓인 메시지는 Slack 알림으로 즉시 파악하고, 원인 분석 후 수동으로 재처리하거나 폐기합니다.

---

## 결과 및 회고

Kafka 도입 후 달라진 점입니다.

- 결제 서비스가 일시적으로 다운돼도 **주문 이벤트가 Kafka에 남아있어** 복구 후 자동으로 처리됩니다.
- 나중에 알림 서비스를 추가할 때 `order-created` 토픽만 구독하면 됐습니다. **기존 코드 수정이 전혀 없었습니다.**
- 반면 Outbox 패턴, 멱등성 처리, DLQ 등 **관리 포인트가 늘어났습니다.** 단순한 시스템이라면 오버엔지니어링이 될 수 있습니다.

Kafka는 강력하지만, 도입 자체가 목적이 되면 안 됩니다. **서비스 간 결합도 문제와 이벤트 재처리 필요성이 명확할 때** 도입하는 것이 맞다고 생각합니다.
