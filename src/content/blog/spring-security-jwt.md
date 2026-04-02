---
title: "Spring Security 6로 JWT 인증 구현하기"
description: "Spring Security 6 환경에서 Stateless JWT 인증을 깔끔하게 구현하는 방법 — 필터 체인, 토큰 발급, 리프레시 토큰 전략까지"
pubDate: 2026-01-08
category: "architecture"
tags: ["Spring Boot", "Spring Security", "JWT", "Java"]
---

## Spring Security 6의 변경점

Spring Security 6에서 `WebSecurityConfigurerAdapter`가 제거되었습니다. 이제 설정은 `SecurityFilterChain` Bean으로 합니다. 예전 프로젝트를 마이그레이션한다면 이 부분부터 바꿔야 합니다.

## 프로젝트 구조

```
auth/
├── JwtTokenProvider.java
├── JwtAuthenticationFilter.java
├── SecurityConfig.java
├── AuthController.java
└── RefreshTokenService.java
```

## JwtTokenProvider

```java
@Component
public class JwtTokenProvider {

    @Value("${jwt.secret}")
    private String secretKey;

    private static final long ACCESS_TOKEN_EXPIRY  = 1000L * 60 * 30;          // 30분
    private static final long REFRESH_TOKEN_EXPIRY = 1000L * 60 * 60 * 24 * 7; // 7일

    private Key getSigningKey() {
        return Keys.hmacShaKeyFor(secretKey.getBytes(StandardCharsets.UTF_8));
    }

    public String createAccessToken(String email, String role) {
        return Jwts.builder()
            .setSubject(email)
            .claim("role", role)
            .setIssuedAt(new Date())
            .setExpiration(new Date(System.currentTimeMillis() + ACCESS_TOKEN_EXPIRY))
            .signWith(getSigningKey(), SignatureAlgorithm.HS256)
            .compact();
    }

    public Claims parseClaims(String token) {
        return Jwts.parserBuilder()
            .setSigningKey(getSigningKey())
            .build()
            .parseClaimsJws(token)
            .getBody();
    }

    public boolean isTokenValid(String token) {
        try {
            parseClaims(token);
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            return false;
        }
    }
}
```

## JwtAuthenticationFilter

```java
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtTokenProvider tokenProvider;
    private final UserDetailsService userDetailsService;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {

        String token = resolveToken(request);

        if (token != null && tokenProvider.isTokenValid(token)) {
            Claims claims = tokenProvider.parseClaims(token);
            UserDetails user = userDetailsService.loadUserByUsername(claims.getSubject());

            UsernamePasswordAuthenticationToken auth =
                new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities());
            auth.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));

            SecurityContextHolder.getContext().setAuthentication(auth);
        }

        filterChain.doFilter(request, response);
    }

    private String resolveToken(HttpServletRequest request) {
        String bearer = request.getHeader("Authorization");
        if (StringUtils.hasText(bearer) && bearer.startsWith("Bearer ")) {
            return bearer.substring(7);
        }
        return null;
    }
}
```

## SecurityConfig

```java
@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtTokenProvider tokenProvider;
    private final UserDetailsService userDetailsService;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/auth/**").permitAll()
                .anyRequest().authenticated()
            )
            .addFilterBefore(
                new JwtAuthenticationFilter(tokenProvider, userDetailsService),
                UsernamePasswordAuthenticationFilter.class
            )
            .build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
```

## 리프레시 토큰 전략

리프레시 토큰은 인메모리가 아닌 **DB에 저장**하세요. 서버 재시작 후에도 유지되고, 필요할 때 강제 만료(로그아웃, 탈취 대응)도 가능합니다.

`/api/auth/refresh` 요청 시 저장된 토큰을 검증하고, 새 액세스 토큰을 발급합니다. 보안을 더 강화하려면 리프레시 토큰도 매번 교체(Rotation)하세요.

프론트엔드에서 토큰을 `localStorage`에 저장하는 건 XSS에 취약합니다. 웹 클라이언트라면 `httpOnly` 쿠키를 사용하세요.
