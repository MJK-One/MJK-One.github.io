---
title: "JPA N+1 문제, 제대로 이해하고 해결하기"
description: "N+1 쿼리가 왜 발생하는지 원인을 파악하고, Fetch Join과 EntityGraph로 실전에서 해결하는 방법"
pubDate: 2026-04-01
category: "troubleshooting"
tags: ["Spring Boot", "JPA", "Java", "MySQL"]
---

## N+1 문제란?

연관 엔티티를 조회할 때 예상보다 훨씬 많은 쿼리가 실행되는 현상입니다. 예를 들어 주문 목록 10개를 조회(1번)하면서 각 주문의 회원 정보를 따로 조회(10번)해 총 11번의 쿼리가 나가는 상황입니다.

```java
// 이 코드가 N+1을 유발합니다
List<Order> orders = orderRepository.findAll(); // 쿼리 1번
for (Order order : orders) {
    System.out.println(order.getMember().getName()); // 회원 조회 N번
}
```

`LAZY` 로딩 설정에서 연관 엔티티에 접근하는 순간 개별 쿼리가 추가로 발생합니다.

## 해결 방법 1: Fetch Join

JPQL에서 `JOIN FETCH`를 사용하면 연관 엔티티를 한 번에 가져옵니다.

```java
@Repository
public interface OrderRepository extends JpaRepository<Order, Long> {

    @Query("SELECT o FROM Order o JOIN FETCH o.member WHERE o.status = :status")
    List<Order> findByStatusWithMember(@Param("status") OrderStatus status);
}
```

실행되는 쿼리는 단 1번, JOIN으로 한꺼번에 가져옵니다.

## 해결 방법 2: @EntityGraph

어노테이션으로 더 간단하게 설정할 수 있습니다.

```java
@EntityGraph(attributePaths = {"member", "orderItems"})
@Query("SELECT o FROM Order o WHERE o.status = :status")
List<Order> findByStatusWithDetails(@Param("status") OrderStatus status);
```

## 해결 방법 3: Batch Size

컬렉션 연관관계(`OneToMany`)에서 Fetch Join은 페이징이 안 됩니다. 이 경우엔 `@BatchSize`를 씁니다.

```java
@Entity
public class Member {

    @BatchSize(size = 100)
    @OneToMany(mappedBy = "member", fetch = FetchType.LAZY)
    private List<Order> orders = new ArrayList<>();
}
```

또는 `application.yml`에서 전역 설정:

```yaml
spring:
  jpa:
    properties:
      hibernate:
        default_batch_fetch_size: 100
```

이렇게 하면 IN 쿼리로 묶어서 가져오기 때문에 쿼리 수가 대폭 줄어듭니다.

## 어떤 방법을 언제 쓸까?

| 상황 | 추천 방법 |
|------|-----------|
| 단건 또는 소수 조회 | Fetch Join |
| 페이징 + 컬렉션 | BatchSize |
| 코드를 간결하게 | @EntityGraph |

N+1은 로그에서 쿼리 수를 모니터링하지 않으면 모르고 지나치기 쉽습니다. 개발 환경에서 `show_sql: true` + `format_sql: true`를 켜두고 습관적으로 확인하는 게 중요합니다.
