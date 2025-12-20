# Lightweight PostgreSQL Client - VSCode Extension

## 프로젝트 개요
VSCode에서 PostgreSQL 데이터베이스에 SQL을 실행하고 결과를 확인할 수 있는 경량 클라이언트 확장 프로그램.

## 기술 스택
- **Language**: TypeScript
- **Framework**: VSCode Extension API
- **Database**: PostgreSQL (node-postgres / pg)
- **UI**: VSCode Webview (React 또는 Vanilla JS)
- **Build**: esbuild 또는 webpack

## 핵심 기능
1. PostgreSQL 연결 관리 (다중 연결 지원)
2. SQL 에디터 (구문 강조, 자동완성)
3. 쿼리 실행 및 결과 표시
4. 테이블/스키마 탐색기
5. 쿼리 히스토리

## 개발 가이드라인

### 코드 스타일
- ESLint + Prettier 사용
- 함수형 프로그래밍 선호
- 에러 처리 철저히

### 파일 구조 (권장)
```
src/
├── extension.ts          # 진입점
├── commands/             # VSCode 커맨드
├── providers/            # TreeDataProvider, CompletionProvider 등
├── services/             # 비즈니스 로직
│   ├── connection.ts     # DB 연결 관리
│   └── query.ts          # 쿼리 실행
├── views/                # Webview 관련
│   ├── results/          # 결과 표시 패널
│   └── explorer/         # DB 탐색기
├── models/               # 타입 정의
└── utils/                # 유틸리티
```

## 서브 에이전트 활용 가이드

### 1. /vscode-api - VSCode Extension API 전문가
VSCode Extension API 관련 질문, 패턴, 베스트 프랙티스 조회시 사용

### 2. /pg-query - PostgreSQL 쿼리 전문가
PostgreSQL 쿼리 작성, 최적화, node-postgres 사용법 조회시 사용

### 3. /webview-ui - Webview UI 개발 전문가
VSCode Webview 패널 개발, 메시지 통신, UI 구현시 사용

### 4. /test-ext - 익스텐션 테스트 전문가
VSCode 익스텐션 테스트 작성 및 실행시 사용

### 5. /build-ext - 빌드 및 패키징 전문가
익스텐션 빌드, 번들링, VSIX 패키징시 사용

## 참고 리소스
- [VSCode Extension API](https://code.visualstudio.com/api)
- [node-postgres](https://node-postgres.com/)
- [VSCode Webview API](https://code.visualstudio.com/api/extension-guides/webview)
