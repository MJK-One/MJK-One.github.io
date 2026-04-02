# minjun.log

민준의 개인 블로그 & 포트폴리오 사이트
**Astro** + **GitHub Pages** 기반

---

## 블로그 글 작성

### 파일 위치
```
src/content/blog/파일명.md
```

### 파일 형식
```markdown
---
title: 'AOP로 공통 로깅 처리하기'
description: '반복되는 로깅 코드를 AOP로 깔끔하게 분리한 과정'
pubDate: 2026-04-02
category: 'architecture'
tags: ['Spring Boot', 'Java', 'AOP']
draft: false
---

본문을 마크다운으로 작성합니다.
```

### 카테고리 종류

| category 값 | 설명 |
|---|---|
| `troubleshooting` | 시행착오, 버그 해결 |
| `performance` | 성능 개선 |
| `devops` | 배포, 인프라 |
| `architecture` | 설계, 구조 |

> `draft: true` 로 설정하면 배포되지 않고 숨겨집니다.

---

## 포트폴리오 카드 추가

`src/pages/portfolio.astro` 상단 `projects` 배열에 추가:

```js
{
  id: 'my-project',          // 고유 id (영문, 중복 금지)
  title: '프로젝트 이름',
  subtitle: '영문 부제',
  github: 'https://github.com/MJK-One/...',
  description: '카드에 표시될 한 줄 설명',
  image: '/images/my-project.png',   // public/ 폴더 기준
  imageAlt: '이미지 설명',
  tags: [
    { name: 'Spring Boot', color: 'tb' },
    { name: 'MySQL',       color: 'tg' },
  ],
  detail: {
    overview: '프로젝트 전체 개요 (모달에 표시)',
    role: [
      '팀장으로서 전체 일정 관리',
      'API 설계 및 구현',
    ],
    challenge: '어려웠던 점',
    solution: '해결 방법',
  },
},
```

### 태그 색상 코드

| 코드 | 색상 |
|---|---|
| `tb` | 파랑 |
| `tv` | 보라 |
| `tc` | 하늘 |
| `tg` | 초록 |
| `to` | 주황 |
| `tp` | 빨강 |

### 이미지 추가
`public/images/` 폴더에 이미지 파일을 넣고 경로를 `/images/파일명.png` 로 지정합니다.

---

## 배포

글 작성 또는 수정 후:

```bash
git add .
git commit -m "커밋 메시지"
git push
```

푸시하면 **GitHub Actions가 자동으로 빌드 → GitHub Pages 배포**합니다. (약 1~2분 소요)

---

## 로컬 개발 서버

```bash
npm install      # 최초 1회
npm run dev      # http://localhost:4321
```

---

## 기술 스택

- [Astro](https://astro.build/) — 정적 사이트 생성
- GitHub Actions — 자동 배포
- GitHub Pages — 호스팅
