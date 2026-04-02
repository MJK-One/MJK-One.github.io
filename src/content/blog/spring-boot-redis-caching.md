---
title: "Reducing API Latency with Redis Caching in Spring Boot"
description: "How I cut response times by 80% using Spring Cache with Redis — setup, annotations, and real-world pitfalls."
pubDate: 2026-03-20
category: "performance"
tags: ["Spring Boot", "Redis", "Caching", "Java"]
---

## The Problem

Our team project had a product listing API that hit the database on every request. With concurrent users, response times climbed past 400ms. The data wasn't changing frequently — a perfect candidate for caching.

## Setting Up Redis Cache

First, add the dependencies to `build.gradle`:

```groovy
implementation 'org.springframework.boot:spring-boot-starter-data-redis'
implementation 'org.springframework.boot:spring-boot-starter-cache'
```

Then configure the cache manager:

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

## Using Cache Annotations

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

## Key Pitfalls

**1. Cache stampede on cold start**
When the cache expires, multiple requests hit the DB simultaneously. Consider using a lock or `@CacheLock` strategy for high-traffic endpoints.

**2. Serialization issues**
If your cached object doesn't implement `Serializable` or lacks a default constructor, Jackson will throw on deserialization. Always test with actual objects.

**3. TTL strategy**
Don't use the same TTL for everything. Product listings can last 10 minutes; user session data maybe 30 seconds.

## Result

After caching the top 5 most-queried endpoints, average response time dropped from 420ms to ~60ms. The database load reduced by roughly 70% under load testing.

Caching is one of the highest-ROI optimizations you can make — just be intentional about what you cache and for how long.
