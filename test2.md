# 프로젝트 가이드

## 소개

이 문서는 프로젝트 참여자를 위한 안내 문서입니다.

## 환경 설정

### 필수 도구

- **Node.js** v18 이상
- **Git** v2.30 이상
- **Docker** (선택 사항)

### 설치 방법

```bash
# 저장소 클론
git clone https://example.com/repo.git

# 의존성 설치
npm install

# 개발 서버 실행
npm run dev
```

## 브랜치 전략

| 브랜치 | 용도 | 병합 대상 |
|--------|------|-----------|
| `main` | 프로덕션 배포 | - |
| `develop` | 개발 통합 | main |
| `feature/*` | 기능 개발 | develop |
| `hotfix/*` | 긴급 수정 | main |

## 커밋 메시지 규칙

```
<타입>: <설명>

예시:
feat: 로그인 기능 추가
fix: 이메일 유효성 검사 오류 수정
docs: README 업데이트
```

## 체크리스트

- [x] 저장소 클론
- [x] 환경 변수 설정
- [ ] 테스트 실행
- [ ] 코드 리뷰 요청

## 자주 묻는 질문

<details>
<summary>빌드가 실패하면 어떻게 하나요?</summary>

1. `node_modules` 삭제 후 재설치
2. 환경 변수 확인
3. Node.js 버전 확인

</details>

<details>
<summary>포트 충돌이 발생하면?</summary>

`.env` 파일에서 `PORT` 값을 변경하세요.

</details>

## 참고 자료

> 좋은 코드는 그 자체로 문서가 된다. — *Steve McConnell*

---

*마지막 수정: 2026-03-21*
