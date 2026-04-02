---
title: "Spring Boot에서 Redis 캐싱으로 API 응답속도 80% 줄이기"
description: "Spring Cache + Redis로 응답 시간을 80% 단축한 경험 — 설정, 어노테이션, 실전 주의사항까지"
pubDate: 2026-03-20
category: "performance"
tags: ["Spring Boot", "Redis", "Java", "Caching"]
---

## 문제 상황

팀 프로젝트에서 상품 목록 API가 요청마다 DB를 직접 조회하고 있었습니다. 동시 접속자가 늘어나면서 응답 시간이 400ms를 넘기 시작했는데, 데이터가 자주 바뀌지 않는 구조라 캐싱을 적용하기에 딱 좋은 상황이었습니다.

## Redis 캐시 설정

`build.gradle`에 의존성을 추가합니다.

```groovy
implementation 'org.springframework.boot:spring-boot-starter-data-redis'
implementation 'org.springframework.boot:spring-boot-starter-cache'
```

그다음 CacheManager를 Bean으로 등록합니다.

```java
@Configuration
@EnableCaching
public class CacheConfig {

    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory factory) {
        RedisCacheConfiguration config = RedisCacheConfiguration.defaultCacheConfig()
            .entryTtl(Duration.ofMinutes(10))
            .serializeValuesWith(
                RedisSerializationContext.SerializationPair
                    .fromSerializer(new GenericJackson2JsonRedisSerializer())
            );

        return RedisCacheManager.builder(factory)
            .cacheDefaults(config)
            .build();
    }
}
```

## 캐시 어노테이션 적용

```java
@Service
@RequiredArgsConstructor
public class ProductService {

    private final ProductRepository productRepository;

    @Cacheable(value = "products", key = "#categoryId")
    public List<ProductResponse> getByCategory(Long categoryId) {
        return productRepository.findByCategoryId(categoryId)
            .stream()
            .map(ProductResponse::from)
            .toList();
    }

    @CacheEvict(value = "products", key = "#product.categoryId")
    public void saveProduct(Product product) {
        productRepository.save(product);
    }
}
```

## 실전에서 주의할 점

**1. Cache Stampede (캐시 스탬피드)**
캐시가 만료되는 순간 여러 요청이 동시에 DB를 때리는 현상입니다. 트래픽이 많은 엔드포인트는 분산락이나 별도 갱신 전략을 고려해야 합니다.

**2. 직렬화 문제**
캐시 대상 객체가 `Serializable`을 구현하지 않거나 기본 생성자가 없으면 역직렬화 시 예외가 발생합니다. 실제 객체로 반드시 테스트해보세요.

**3. TTL 전략**
모든 캐시에 같은 TTL을 쓰면 안 됩니다. 상품 목록은 10분, 사용자 세션 데이터는 30초처럼 데이터 특성에 맞게 나눠서 설정해야 합니다.

## 결과

가장 많이 조회되는 엔드포인트 5개에 캐싱을 적용하고 나서, 평균 응답 시간이 420ms에서 약 60ms로 줄었습니다. 부하 테스트 기준 DB 조회량도 70% 가까이 감소했습니다.

캐싱은 투자 대비 효과가 가장 큰 최적화 중 하나입니다. 다만 무엇을 얼마 동안 캐시할지는 항상 신중하게 결정해야 합니다.
