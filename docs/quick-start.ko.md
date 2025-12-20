# Quick Start Guide

## 1. 연결 추가

1. 사이드바에서 PostgreSQL 아이콘 클릭
2. **+** 버튼 클릭
3. 연결 정보 입력 또는 연결 문자열 붙여넣기

```
postgresql://user:password@localhost:5432/database
```

## 2. 연결하기

- Connections 목록에서 연결 항목의 플러그 아이콘 클릭
- 또는 우클릭 → **Connect**

## 3. 쿼리 실행

1. SQL 파일 열기 또는 새 쿼리 생성
2. SQL 작성:
   ```sql
   SELECT * FROM users WHERE active = true;
   ```
3. `Cmd+Enter` (Mac) / `Ctrl+Enter` (Windows)

## 4. 결과 보기

- 하단 패널에서 결과 확인
- CSV/JSON 내보내기 가능
- 행 선택 후 **View JSON**으로 JSON 형식 보기

## 5. 데이터 편집

1. **Enable Editing** 클릭
2. 테이블명, PK 컬럼 지정
3. 셀 더블클릭으로 편집
4. **Save Changes**로 저장

## 주요 단축키

| 기능 | Mac | Windows |
|------|-----|---------|
| 쿼리 실행 | `Cmd+Enter` | `Ctrl+Enter` |

## 팁

- SELECT에 LIMIT 없으면 자동으로 100개로 제한
- 데이터 변경 쿼리는 확인 팝업 표시
- NULL 입력: 셀 편집 시 **NULL** 버튼 클릭
