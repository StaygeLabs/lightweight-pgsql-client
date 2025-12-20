# Lightweight PostgreSQL Client 사용자 매뉴얼

## 목차

1. [시작하기](#시작하기)
2. [연결 관리](#연결-관리)
3. [쿼리 실행](#쿼리-실행)
4. [스키마 탐색](#스키마-탐색)
5. [쿼리 결과](#쿼리-결과)
6. [데이터 편집](#데이터-편집)
7. [세션 관리](#세션-관리)
8. [쿼리 히스토리](#쿼리-히스토리)
9. [단축키](#단축키)
10. [설정](#설정)

---

## 시작하기

### 설치

1. VS Code에서 Extensions 탭 열기 (`Cmd+Shift+X` / `Ctrl+Shift+X`)
2. "Lightweight PostgreSQL Client" 검색
3. Install 클릭

### 첫 화면

설치 후 Activity Bar(왼쪽 사이드바)에 데이터베이스 아이콘이 추가됩니다. 클릭하면 PostgreSQL 탐색기가 열립니다.

---

## 연결 관리

### 새 연결 추가

1. PostgreSQL 탐색기 상단의 `+` 버튼 클릭
2. 연결 방법 선택:
   - **New Connection**: 폼에서 직접 입력
   - **Quick Connect**: 연결 문자열로 빠르게 연결

### 연결 폼 입력

| 필드 | 설명 | 예시 |
|------|------|------|
| Connection Name | 연결 이름 (표시용) | My Database |
| Host | 서버 주소 | localhost |
| Port | 포트 번호 | 5432 |
| Database | 데이터베이스 이름 | postgres |
| Username | 사용자 이름 | postgres |
| Password | 비밀번호 | ●●●●●● |
| Use SSL | SSL 사용 여부 | 체크/해제 |

### 연결 문자열 형식

```
postgresql://username:password@host:port/database?sslmode=require
```

예시:
```
postgresql://postgres:mypassword@localhost:5432/mydb
```

### 연결/연결 해제

- **연결**: Connections 목록에서 연결 항목의 플러그 아이콘 클릭
- **연결 해제**: 연결된 항목의 연결 해제 아이콘 클릭
- 우클릭 메뉴에서도 Connect/Disconnect 선택 가능

### 연결 편집/삭제

연결 항목을 우클릭하여:
- **Edit Connection**: 연결 설정 수정
- **Delete Connection**: 연결 삭제

### 비밀번호 저장

- 비밀번호는 VS Code의 Secret Storage에 안전하게 저장됩니다
- 저장하지 않으면 연결할 때마다 입력해야 합니다

---

## 쿼리 실행

### SQL 파일 열기

1. 새 SQL 파일 생성: `Cmd+N` → 언어 모드를 SQL로 변경
2. 또는 PostgreSQL 탐색기에서 **New Query** 버튼 클릭
3. 기존 `.sql` 파일 열기

### 쿼리 실행

1. SQL 문 작성
2. 실행 방법:
   - **단축키**: `Cmd+Enter` (Mac) / `Ctrl+Enter` (Windows/Linux)
   - **에디터 상단**: 실행 버튼(▶) 클릭
   - **명령 팔레트**: `PostgreSQL: Execute Query`

### 문서별 연결 설정

각 SQL 문서는 독립적인 연결을 가질 수 있습니다:

1. 에디터 상단 또는 하단 상태바의 연결 표시 클릭
2. 원하는 연결 선택
3. 연결되지 않은 항목 선택 시 자동으로 연결 시도

### 부분 실행

- 텍스트를 선택한 상태에서 실행하면 선택한 부분만 실행
- 선택하지 않으면 커서 위치의 SQL 문 실행

### 자동 LIMIT 적용

- SELECT 쿼리에 LIMIT이 없으면 자동으로 `LIMIT 100` 추가
- 결과가 100개면 "100+ rows" 표시와 **View More** 버튼 제공
- **View More** 클릭 시 다음 100개 데이터 추가 로드
- 모든 데이터가 로드되면 버튼 숨김

### 쿼리 취소

실행 중인 쿼리를 취소할 수 있습니다:

1. **취소 버튼**: 에디터 상단의 정지 버튼(■) 클릭 (쿼리 실행 중에만 표시)
2. **명령 팔레트**: `PostgreSQL: Cancel Query`
3. PostgreSQL의 `pg_cancel_backend()` 함수를 사용하여 쿼리 취소

### 여러 SQL 문

세미콜론(`;`)으로 구분된 여러 SQL 문이 있으면:
- 첫 번째 문만 실행
- "Multiple statements detected" 메시지 표시

### 데이터 변경 쿼리 확인

INSERT, UPDATE, DELETE 등 데이터 변경 쿼리 실행 시:
- 확인 팝업 표시
- 연결 이름과 SQL 내용 확인
- **Execute** 클릭 시 실행

---

## 스키마 탐색

### 구조

연결 후 다음 계층으로 스키마를 탐색할 수 있습니다:

```
📁 Connection Name
  └── 📁 schema_name
      ├── 📁 Tables
      │   └── 📋 table_name
      │       ├── column1 (integer)
      │       └── column2 (varchar)
      └── 📁 Views
          └── 👁 view_name
```

### 테이블 정보 보기

테이블/뷰를 우클릭하거나 info 아이콘 클릭:

- **Columns**: 컬럼 목록, 타입, NULL 허용, 기본값, PK 여부
- **Indexes**: 인덱스 정보, 유니크/Primary 여부, 조건(Partial Index)
- **Foreign Keys**: 외래 키 관계
- **Constraints**: 제약 조건
- **Statistics**: 행 수, 테이블/인덱스 크기

### DDL 보기

테이블 정보 패널에서:
- **View DDL**: 새 문서에서 DDL 보기
- **Copy DDL**: DDL을 클립보드에 복사

### 빠른 쿼리

테이블 우클릭:
- **SELECT TOP 100**: `SELECT * FROM table LIMIT 100` 쿼리 생성
- **Copy Table Name**: 스키마.테이블명 복사

---

## 쿼리 결과

### 결과 패널

쿼리 실행 후 하단 패널에 결과 표시:

- **연결 정보**: 어떤 연결에서 실행했는지 표시
- **행 수**: 반환된 행 수
- **실행 시간**: 쿼리 실행 시간(ms)

### 페이지네이션

대용량 결과셋(100행 초과)에 대해 페이지네이션 지원:

- **처음**, **이전**, **다음**, **마지막** 버튼으로 이동
- 페이지 번호 직접 입력으로 이동
- 페이지 크기 변경 (100, 500, 1000, 5000행)
- 현재 행 범위 표시 (예: "1-500 of 90000 rows")
- 대용량 결과셋(9만건 이상) 효율적 처리

### 데이터 내보내기

- **CSV**: CSV 파일로 내보내기
- **JSON**: JSON 파일로 내보내기
- **Copy**: 탭으로 구분된 텍스트로 복사

### 행 선택

- 각 행의 체크박스로 선택
- 여러 행 선택 가능

### JSON으로 보기

1. 원하는 행 체크박스 선택
2. **View JSON** 버튼 클릭
3. 새 문서에서 JSON 형식으로 표시
   - 1개 선택: 단일 객체
   - 여러 개 선택: 배열

---

## 데이터 편집

### 편집 모드 활성화

1. 쿼리 실행 후 결과 패널에서 **Enable Editing** 클릭
2. 테이블명과 Primary Key 컬럼 지정
3. 또는 자동 감지된 설정 사용 (id, *_id 컬럼)

### 셀 편집

1. 셀을 **더블클릭**하여 편집 모드 진입
2. 값 입력 후:
   - **Enter**: 저장
   - **Tab**: 다음 셀로 이동
   - **Escape**: 취소
3. 수정된 셀은 녹색 표시

### NULL 값 입력

- 셀 편집 시 옆에 **NULL** 버튼 표시
- 클릭하면 NULL 값으로 설정
- 빈 문자열('')과 NULL은 구분됨

### 행 추가

1. **+ Add Row** 버튼 클릭
2. 새 행이 테이블 하단에 추가 (녹색 배경)
3. 각 셀에 값 입력

### 행 삭제

1. 삭제할 행의 체크박스 선택
2. **Delete Selected** 버튼 클릭
3. 삭제 예정 행은 취소선으로 표시

### 변경 저장

1. **Save Changes** 버튼 클릭
2. 모든 변경사항이 데이터베이스에 반영
3. 실행된 SQL은 쿼리 히스토리에 기록

### 변경 취소

- **Discard** 버튼: 모든 변경사항 취소

---

## 세션 관리

활성 데이터베이스 세션을 조회하고 관리합니다.

### 세션 패널 열기

1. 에디터 상단의 세션 버튼 클릭 (SQL 파일 열려있을 때)
2. 또는 명령 팔레트: `PostgreSQL: Show Active Sessions`
3. 여러 연결이 있으면 조회할 연결 선택

### 세션 패널 기능

- **세션 목록**: PID, 데이터베이스, 사용자, 애플리케이션, 클라이언트, 상태, 실행 시간, 쿼리 표시
- **상태 배지**: 전체 세션, Active, Idle, Idle in Transaction 개수 표시
- **자동 새로고침**: 5초, 10초, 30초, 60초 간격으로 자동 갱신 가능

### 세션 작업

- **Cancel Query**: 실행 중인 쿼리 취소 (`pg_cancel_backend()` 사용)
  - "active" 상태의 세션에서만 사용 가능
- **Kill Session**: 세션 강제 종료 (`pg_terminate_backend()` 사용)
  - 주의: 연결을 강제로 종료함
- **Copy Query**: 현재 실행 중인 쿼리를 클립보드에 복사

### 세션 상태

| 상태 | 설명 |
|------|------|
| active | 현재 쿼리 실행 중 |
| idle | 연결되었지만 대기 중 |
| idle in transaction | 트랜잭션 내에서 명령 대기 중 |

---

## 쿼리 히스토리

### 히스토리 보기

PostgreSQL 탐색기의 **Query History** 섹션에서 확인

### 표시 정보

- SQL 문 (앞부분)
- 실행 시간
- 행 수
- 에러 여부

### 히스토리 사용

- 항목 클릭: 해당 SQL을 새 문서에서 열기
- 연결 정보도 함께 표시

### 히스토리 삭제

- 히스토리 섹션 우클릭 → **Clear History**

---

## 단축키

| 기능 | Mac | Windows/Linux |
|------|-----|---------------|
| 쿼리 실행 | `Cmd+Enter` | `Ctrl+Enter` |
| 새 파일 | `Cmd+N` | `Ctrl+N` |
| 명령 팔레트 | `Cmd+Shift+P` | `Ctrl+Shift+P` |

---

## 설정

VS Code 설정에서 `pgsql`로 검색:

| 설정 | 설명 | 기본값 |
|------|------|--------|
| `pgsql.maxRows` | 최대 조회 행 수 | 1000 |
| `pgsql.queryTimeout` | 쿼리 타임아웃 (ms) | 30000 |

---

## 문제 해결

### 연결 실패

1. 호스트/포트 확인
2. 사용자명/비밀번호 확인
3. 데이터베이스 이름 확인
4. PostgreSQL 서버 실행 여부 확인
5. 방화벽 설정 확인

### SSL 연결 오류

- 연결 설정에서 **Use SSL** 체크
- 또는 연결 문자열에 `?sslmode=require` 추가

### 쿼리 타임아웃

- 설정에서 `pgsql.queryTimeout` 값 증가

---

## 지원

문제 보고: [GitHub Issues](https://github.com/steve/lightweight-pgsql-client/issues)
