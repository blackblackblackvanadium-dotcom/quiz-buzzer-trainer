# QBT-10 APP｜Phase 1 Current Spec 実装適合監査

## 監査前提

- Source of Truth: `blackblackblackvanadium-dotcom/quiz-buzzer-trainer`
- Audit target: `main@06ac753a1535f5e746b358296ad69350d8749af5`
- GitHub Actions Baseline run #3: `npm install` / `npm run typecheck` / `npm test` / `npm run build` = **4/4 PASS**（CORE確認済み）
- 監査中の機能コード変更、新機能追加、仕様変更、大規模リファクタは実施しない。
- 判定は `Implemented / Partial / Missing / Conflict` の4分類とする。

### 判定定義

| 判定 | 意味 |
|---|---|
| Implemented | Current Specの要求をコード上満たしている。既存テストが不足する場合は不足テスト欄へ記載する。 |
| Partial | 主経路は存在するが仕様の一部、例外、検証、UI、永続化などが不足している。 |
| Missing | 必須仕様に対応する実装が見当たらない。 |
| Conflict | 実装の意味・挙動・データ契約がCurrent Specと異なる。 |

---

## REQ

| 仕様IDまたは要件 | 判定 | 対応ソース | 対応テスト | 不足テスト | 根拠 |
|---|---|---|---|---|---|
| Phase 1で Normal / Kimari-ji / Review / Survival / Study の5モードを提供 | Implemented | `src/domain/types.ts`, `src/App.tsx`, `src/modes/strategies.ts` | `tests/engine/stateMachine.test.ts`, `tests/modes/strategies.test.ts` | 各モードのUI/integration/E2E | `quizModes`に5モードがありAppから全モードへ到達できる。 |
| Normal基本フロー | Implemented | `src/pages/PlayPage.tsx`, `src/engine/stateMachine.ts` | `tests/engine/stateMachine.test.ts` | Normal end-to-end | READY→READING→BUZZ→ANSWERING→RESULT→NEXTの主経路が存在。 |
| Kimari-jiはCurrent Specで定義されたKimari-ji固有ポリシーを実装 | Missing | `src/modes/strategies.ts` | なし | Kimari-ji選定・判定・決まり字境界の全テスト | 実装自身が`requires-core-clarification`としており、Kimari固有ロジックを持たず全問題を返す。Current Specは既に確定済み。 |
| Reviewは対象問題だけを選定し、学習状態を更新 | Partial | `src/modes/strategies.ts`, `src/modes/studyScheduler.ts`, `src/pages/PlayPage.tsx` | `tests/modes/strategies.test.ts` | Review完走、Pass/Skip、transaction rollback | due問題選定とStudyState更新はあるが、Review全フロー検証がない。 |
| SurvivalはCurrent Specの終了条件・score/life規則に従う | Missing | `src/modes/strategies.ts`, `src/pages/PlayPage.tsx` | なし | fail/clear/score/終了条件/Skip可否 | 実装自身が終了規則未確定扱いで、通常モードとほぼ同じ進行。 |
| Study固有フロー | Partial | `src/engine/stateMachine.ts`, `src/pages/PlayPage.tsx`, `src/modes/studyScheduler.ts` | `tests/engine/stateMachine.test.ts` | Study UI、Study persistence、再学習schedule | Typewriter/BUZZを飛ばして全文回答へ進む経路はあるが、Study全仕様の受入テストがない。 |
| PassをAttemptとして扱いScoredから除外 | Partial | `src/pages/PlayPage.tsx`, `src/domain/types.ts`, `src/analytics/kpis.ts` | `tests/analytics/kpis.test.ts` | pre/post-BUZZ Pass、mode別Pass semantics | `outcome='pass'`保存とAnalytics除外はある。mode別挙動は未検証。 |
| SkipをScoredから除外 | Partial | `src/pages/PlayPage.tsx`, `src/domain/types.ts`, `src/analytics/kpis.ts` | `tests/analytics/kpis.test.ts`はPassのみ明示検証 | Skip専用、mode別Skip semantics | `outcome='skip'`はScored対象外だがSkip固有受入テストがない。 |
| Session開始/終了を永続化 | Partial | `src/pages/PlayPage.tsx`, `src/data/repositories.ts`, `src/domain/types.ts` | なし | start/end、natural finish、manual end、error end | session create/endはあるが、自然完走時はcomponent unmountまで`endedAt`が確定しない。 |
| Session終了理由を保持 | Missing | `src/domain/types.ts` | なし | exhausted/failed/interrupted/error等 | `QuizSession`は`endedAt`のみでend reasonを持たない。 |
| Session中eligible poolを固定 | Implemented | `src/pages/PlayPage.tsx` | なし | DB変更後もsession pool不変のintegration test | mount時に質問群を読み込みReact stateへ固定する。 |
| Phase 1初期問題データ約1000問 | Missing | `src/data/seed.ts` | なし | dataset count/validation | repository内seedは3問のみで、Question import UIも未実装。 |

---

## DATA

| 仕様IDまたは要件 | 判定 | 対応ソース | 対応テスト | 不足テスト | 根拠 |
|---|---|---|---|---|---|
| `questionId + revisionId`で特定版を識別 | Implemented | `src/domain/types.ts`, `src/data/db.ts` | `tests/data/validation.test.ts`の一部 | Dexie roundtrip | Domain/DB/Attemptに両IDが存在しcompound indexもある。 |
| Attemptはquestion revisionへ固定 | Implemented | `src/engine/attemptFactory.ts` | なし | persistence roundtrip | Attempt生成時にquestionId/revisionIdをコピーする。 |
| Question Schema v1に準拠 | Conflict | `src/domain/types.ts`, `src/data/validation.ts` | `tests/data/validation.test.ts` | Current Schema v1 fixture/negative matrix | 現行型は`canonicalAnswer/acceptableAnswers/category/pattern/idealBuzzIndex`等の旧shapeで、Current DATA Schema v1のcanonical shapeと一致しない。 |
| primary/accepted/rejected answerを明示 | Partial | `src/domain/types.ts`, `src/engine/judge.ts` | `tests/engine/judge.test.ts` | Schema v1 naming/serialization | semanticsは存在するがCurrent DATA field contractと命名/shapeが一致しない。 |
| determiningPointsをmethod/provenance付きで保持 | Missing | `src/domain/types.ts` | なし | schema validation、provenance | `idealBuzzIndex/advancedBuzzIndex`のみでCurrent determiningPoints modelがない。 |
| provenanceを保持 | Missing | `src/domain/types.ts` | なし | provenance validation | Questionにprovenance fieldがない。 |
| runtime validation | Partial | `src/data/validation.ts` | `tests/data/validation.test.ts` | Current Schema v1、cross-field constraints、境界値 | parserはあるが旧Question shapeを検証している。 |
| future/unknown schema version拒否 | Partial | `src/data/validation.ts` | `tests/backup/backupValidation.test.ts` | Question dataset schema version、future DB version | Backup version 99拒否はあるがQuestion dataset canonical import契約がない。 |
| revision immutability | Conflict | `src/data/repositories.ts`, `src/data/db.ts` | なし | 同一`questionId+revisionId`上書き拒否 | `QuestionRepository.putMany()`が`bulkPut`で同一keyを上書き可能。 |
| Question import/exportとApp Backup/Restoreを責任分離 | Missing | `src/pages/MorePage.tsx`, `src/backup/backup.ts` | なし | Question import/export | App全体Backup/RestoreはあるがQuestion dataset import/export経路がない。 |
| Dexie repository境界 | Implemented | `src/data/repositories.ts`, `src/data/db.ts` | なし | repository integration | Question/Attempt/Session/StudyState repositoryが分離されている。 |
| Attempt + StudyState atomic transaction | Implemented | `src/data/repositories.ts` | なし | commit/rollback integration | Dexie transactionで同時保存している。 |
| DB migration | Missing | `src/data/db.ts` | なし | v1→v2等migration、rollback | schema version 1のみでmigration処理がない。 |

---

## ENGINE

| 仕様IDまたは要件 | 判定 | 対応ソース | 対応テスト | 不足テスト | 根拠 |
|---|---|---|---|---|---|
| Unicode grapheme単位で分割 | Implemented | `src/engine/grapheme.ts` | `tests/engine/grapheme.test.ts` | variation selector等の追加corpus | `Intl.Segmenter(...,{granularity:'grapheme'})`を使用。combining mark/ZWJを検証済み。 |
| buzzIndex = BUZZ時点までにpresentationへcommit済みのgrapheme数 | Conflict | `src/engine/typewriterEngine.ts` | `tests/engine/typewriterEngine.test.ts` | actual commit vs BUZZ race oracle | `buzz()`がBUZZ直前に`flushScheduledCommitsThrough()`を実行し、まだpresentationにcommitされていない予定分までcommitしてからindexを確定する。 |
| BUZZ時no catch-up reveal | Conflict | `src/engine/typewriterEngine.ts` | `tests/engine/typewriterEngine.test.ts` | delayed timer no-catch-up | while loopで遅延分を複数commitする実装。既存testもt=200でB/Cをcatch-upする挙動を正としている。 |
| commitAt <= buzzAtのみ含めるdeterministic race | Conflict | `src/engine/typewriterEngine.ts` | `tests/engine/typewriterEngine.test.ts` | commitAt < / = / > buzzAt | race判定が実presentation commit時刻ではなくscheduled due時刻ベース。 |
| BUZZ後に追加commitしない | Partial | `src/engine/typewriterEngine.ts` | なし | stale timer callback | `pause()`とtimer clearはあるがstale callback regression testがない。 |
| buzzRatio = buzzIndex / totalGraphemeCount | Partial | `src/engine/typewriterEngine.ts` | `tests/engine/typewriterEngine.test.ts` | 0/near0/0.5/1境界 | 式は正しいが元になるbuzzIndexがCurrent Specと衝突するため派生値も影響を受ける。 |
| monotonic buzzTimeMs | Implemented | `src/engine/typewriterEngine.ts` | `tests/engine/typewriterEngine.test.ts` | pause/active-time edge | `performance.now()`を抽象化したMonotonicClockを使用。 |
| responseTimeMs = BUZZ acceptance→answer submit、ENGINEがauthority | Conflict | `src/pages/PlayPage.tsx` | なし | Engine response timer | React componentが`performance.now()`差分を直接計算しておりENGINE authorityになっていない。 |
| BUZZ handler前段にDB/analytics/animationを置かない | Implemented | `src/pages/PlayPage.tsx` | なし | interaction timing test | `doBuzz`はengine.buzz→state更新のみでDB処理は後段。 |
| judge precedence: rejected→canonical→accepted→incorrect | Implemented | `src/engine/judge.ts` | `tests/engine/judge.test.ts` | collision matrix | 明示的にこの順序で判定する。 |
| fuzzy match禁止、normalized exact match | Implemented | `src/engine/judge.ts` | `tests/engine/judge.test.ts` | fuzzy negative cases | NFKC/lowercase/punctuation除去後の完全一致のみ。 |
| State MachineをEngine側に保持 | Partial | `src/engine/stateMachine.ts`, `src/pages/PlayPage.tsx` | `tests/engine/stateMachine.test.ts` | 全状態×全event matrix、mode別終了 | transition関数はEngine側だがphase stateはReactが直接保持し、Current Specの完全なstate set/terminationを網羅しない。 |
| 全文表示後もBUZZ可能 | Implemented | `src/pages/PlayPage.tsx`, `src/engine/typewriterEngine.ts` | なし | full-text BUZZ | reader complete後もphaseはreadingのままでBUZZ可能。 |

---

## UIUX

| 仕様IDまたは要件 | 判定 | 対応ソース | 対応テスト | 不足テスト | 根拠 |
|---|---|---|---|---|---|
| Main navigation = Play / Study / Records / More | Implemented | `src/App.tsx` | なし | render/navigation test | 4-tab Bottom Navigationを実装。 |
| Active Play中は通常Navigation非表示 | Implemented | `src/App.tsx` | なし | active session UI test | `!activeSession`条件でheader/navを隠す。 |
| Play→BUZZ→Answer→Result→Next | Implemented | `src/pages/PlayPage.tsx` | state unitのみ | UI integration/E2E | 標準主経路を実装。 |
| Bottom Dock大型BUZZ + Safe Area | Implemented | `src/pages/PlayPage.tsx`, `src/styles/app.css` | なし | mobile viewport/touch test | fixed BUZZ dock、96px button、safe-area insetを使用。 |
| 問題文はgrapheme commitに従い表示 | Partial | `src/pages/PlayPage.tsx`, `src/engine/typewriterEngine.ts` | なし | UI commit race | UIはengine snapshotを描画するがENGINE側catch-up conflictの影響を受ける。 |
| BUZZ後演出待ちなしでAnswerへ | Implemented | `src/pages/PlayPage.tsx` | なし | interaction test | BUZZ callback内で即phaseをansweringへ遷移。 |
| Resultから1操作でNext | Implemented | `src/pages/PlayPage.tsx` | なし | result interaction | Next button 1回で次問題へ。 |
| UIはbuzzIndex/buzzRatioを再計算しない | Implemented | `src/pages/PlayPage.tsx` | なし | display contract test | Attemptに保存された値をそのまま表示。 |
| UIはresponse timingを独自計測しない | Conflict | `src/pages/PlayPage.tsx` | なし | Engine/UI timing boundary | ReactがresponseTimeMsを直接算出している。 |
| 320px級スマホ縦画面で横scrollなし | Partial | `src/styles/app.css`, `index.html` | なし | 320px visual/overflow test | mobile-first/flexible CSSだが受入テストなし。 |
| Safe Area | Implemented | `src/styles/app.css`, `index.html` | なし | iOS viewport test | `viewport-fit=cover`とsafe-areaを使用。 |
| Reduced Motion | Implemented | `src/styles/app.css` | なし | CSS acceptance | `prefers-reduced-motion`を実装。 |
| input label/focus/button semantics | Implemented | `src/pages/PlayPage.tsx` | なし | a11y test | label/htmlFor、button、focus style、autoFocusあり。 |
| IME-safe submit | Missing | `src/pages/PlayPage.tsx` | なし | compositionstart/end + Enter | composition stateを扱う処理がない。 |
| EnterのSubmit→Next貫通防止 | Missing | `src/pages/PlayPage.tsx` | なし | key carry-over regression | keyup/keydown carry-throughを防ぐ明示処理がない。 |
| PWA update中もActive Sessionを保護 | Implemented | `src/App.tsx`, `src/pwa.ts` | なし | update-during-session | activeSession中は更新button disabled。 |

---

## ANALYTICS

| 仕様IDまたは要件 | 判定 | 対応ソース | 対応テスト | 不足テスト | 根拠 |
|---|---|---|---|---|---|
| raw Attemptをsource of truthとする | Implemented | `src/analytics/kpis.ts`, `src/data/repositories.ts` | `tests/analytics/kpis.test.ts` | DB→KPI integration | KPIはAttempt配列から都度計算し、派生値をDB固定保存しない。 |
| Scored Attempts = correct/incorrectのみ | Implemented | `src/analytics/kpis.ts` | `tests/analytics/kpis.test.ts` | Skip明示test | `isScoredAttempt`でcorrect/incorrectのみ採用。 |
| Accuracy | Implemented | `src/analytics/kpis.ts` | `tests/analytics/kpis.test.ts` | zero/全correct/全incorrect | correct/scoredで算出。 |
| First-Exposure Accuracyはlogical question単位 | Conflict | `src/analytics/kpis.ts` | なし | revision変更後もfirst exposureを維持するtest | 現実装は`questionId::revisionId`ごとに初回を数えるためrevision変更で再度初見扱いになる。 |
| Correct Median Buzz Ratio | Implemented | `src/analytics/kpis.ts` | なし | odd/even/null median | 実装あり。 |
| Incorrect Median Buzz Ratio | Implemented | `src/analytics/kpis.ts` | なし | odd/even/null median | 実装あり。 |
| Correct Median Response Time | Implemented | `src/analytics/kpis.ts` | なし | odd/even/null median | 実装あり。 |
| Pass/SkipをScored KPIから除外 | Implemented | `src/analytics/kpis.ts` | Passは`tests/analytics/kpis.test.ts` | Skip専用case | outcome filterで除外。 |
| Kimari-ji関連派生指標をCurrent Spec通り算出 | Missing | `src/analytics/kpis.ts` | なし | kimariji index/delta/provenance | Kimari-ji固有KPI/派生値が存在しない。 |

---

## QA

| 仕様IDまたは要件 | 判定 | 対応ソース | 対応テスト | 不足テスト | 根拠 |
|---|---|---|---|---|---|
| Baseline install/typecheck/test/build | Implemented | `.github/workflows/baseline.yml`, `package.json` | GitHub Actions run #3 | なし | CORE確認済み4/4 PASS。 |
| grapheme P0 | Partial | `src/engine/grapheme.ts` | `tests/engine/grapheme.test.ts` | broader Unicode corpus | combining mark/ZWJのみ。 |
| BUZZ即停止/index/ratio/race P0 | Conflict | `src/engine/typewriterEngine.ts` | `tests/engine/typewriterEngine.test.ts` | Current Spec oracle | 既存testがcatch-up挙動を正としておりCurrent Specと逆。 |
| timing P0 | Missing | `src/engine/typewriterEngine.ts`, `src/pages/PlayPage.tsx` | なし | responseTime/active time/clock edge | response timingの正式oracle testがない。 |
| judge P0 | Partial | `src/engine/judge.ts` | `tests/engine/judge.test.ts` | full precedence/normalization matrix | 基本2caseのみ。 |
| State Machine P0 | Partial | `src/engine/stateMachine.ts` | `tests/engine/stateMachine.test.ts` | full transition matrix | 3caseのみ。 |
| Attempt persistence P0 | Missing | `src/data/repositories.ts` | なし | save→reread exact equality | fake-indexeddb setupはあるがrepository testなし。 |
| transaction rollback P0 | Missing | `src/data/repositories.ts`, `src/backup/backup.ts` | なし | injected failure rollback | transaction実装はあるがtestなし。 |
| migration P0 | Missing | `src/data/db.ts` | なし | schema migration | migration自体がない。 |
| 5モード P0 | Missing | `src/modes/strategies.ts` | `tests/modes/strategies.test.ts` | Kimari/Survival/Study/Normal integration | Review due selectionしかmode-specific testがない。 |
| Pass/Skip P0 | Missing | `src/pages/PlayPage.tsx` | なし | pre/post BUZZ、mode別 | UI/DB integration testなし。 |
| Session lifecycle P0 | Missing | `src/pages/PlayPage.tsx`, `src/data/repositories.ts` | なし | start/end/exhaustion/interruption | session testなし。 |
| Backup/Restore P0 | Partial | `src/backup/backup.ts`, `src/data/validation.ts` | `tests/backup/backupValidation.test.ts` | roundtrip/rollback/corrupt/future version | unknown version reject 1caseのみ。 |
| Offline core P0 | Missing | `vite.config.ts`, `src/pwa.ts` | なし | installed/offline cold start + quiz | build artifact存在だけではoffline受入未検証。 |
| Mobile/IME P0 | Missing | `src/styles/app.css`, `src/pages/PlayPage.tsx` | なし | 320px/IME/keyboard | UI testなし。 |
| Security P0 | Missing | `src/data/validation.ts`, `src/pages/MorePage.tsx` | なし | XSS/huge input/multitab/quota | security test suiteなし。 |
| Release Gate: P0 PASS 100%, skipped/flaky/known failure 0 | Missing | `.github/workflows/baseline.yml` | run #3 | P0 matrix execution/evidence | Baselineは14 unit testsのpassのみでPhase 1 P0 Test Matrix全体を実行していない。 |

---

## RELEASE

| 仕様IDまたは要件 | 判定 | 対応ソース | 対応テスト | 不足テスト | 根拠 |
|---|---|---|---|---|---|
| PWA installable build | Implemented | `vite.config.ts`, `src/pwa.ts`, `public/icon.svg` | Baseline run #3 build | install実機test | manifest/generateSW構成がありrun #3 build成功。 |
| offline shell/core | Partial | `vite.config.ts`, `src/pwa.ts` | なし | offline cold start/core quiz | Workbox設定はあるがacceptance testなし。 |
| App Version / DB Schema Version / Question Data Version分離 | Implemented | `src/backup/backup.ts`, `src/data/db.ts` | なし | compatibility matrix | 3種versionは別定数。 |
| portable versioned Backup | Implemented | `src/backup/backup.ts`, `src/data/validation.ts` | `tests/backup/backupValidation.test.ts` | export/import roundtrip | versioned JSON envelopeあり。 |
| Phase 1 Replace Restore only | Implemented | `src/backup/backup.ts`, `src/pages/MorePage.tsx` | なし | replace integration | clear→bulkAddのReplace Restoreのみ。 |
| validation完了前にDB変更しない | Implemented | `src/pages/MorePage.tsx`, `src/data/validation.ts` | `tests/backup/backupValidation.test.ts` | malformed content preserving DB | parse後にconfirm/replaceを実行。 |
| restore atomic rollback | Partial | `src/backup/backup.ts` | なし | injected failure rollback | 1 transactionで実装されるが証跡なし。 |
| migration Expand→Migrate→Verify→Contract | Missing | `src/data/db.ts` | なし | migration acceptance | migration implementationなし。 |
| waiting update + prompt | Implemented | `vite.config.ts`, `src/pwa.ts`, `src/App.tsx` | なし | update integration | `registerType:'prompt'`とrefresh bannerあり。 |
| Active Session中の強制reload禁止 | Implemented | `src/App.tsx` | なし | active-session update | update buttonをdisabled。 |
| AC-01〜AC-20を全PASS・証跡あり | Missing | `.github/workflows/baseline.yml` | run #3 | Release acceptance suite | Baseline 4 GateはPASSだがRelease受入AC群は未実行。 |
| dependency lockをrelease inputとして固定 | Missing | repository root | なし | lockfile reproducibility | target commit treeに`package-lock.json`がない。 |

---

## SECURITY

| 仕様IDまたは要件 | 判定 | 対応ソース | 対応テスト | 不足テスト | 根拠 |
|---|---|---|---|---|---|
| Import/Restore inputをuntrustedとしてruntime validation | Partial | `src/data/validation.ts`, `src/pages/MorePage.tsx` | `tests/backup/backupValidation.test.ts`, `tests/data/validation.test.ts` | huge/corrupt/deep object/current schema | runtime parserはあるがCurrent DATA Schema v1未準拠、size limitもない。 |
| plain-text rendering / XSS抑止 | Implemented | `src/pages/PlayPage.tsx`, `src/pages/RecordsPage.tsx` | なし | malicious payload rendering | React text interpolationを使用し`dangerouslySetInnerHTML`なし。 |
| destructive restore前validation | Implemented | `src/pages/MorePage.tsx`, `src/data/validation.ts` | `tests/backup/backupValidation.test.ts` | DB preservation on invalid backup | parse成功後のみrestore。 |
| restore transaction | Implemented | `src/backup/backup.ts` | なし | rollback test | 全tableを1 Dexie transactionで置換。 |
| SW updateでActive Session保護 | Implemented | `src/App.tsx`, `src/pwa.ts` | なし | multi-tab/update race | activeSession中refresh操作をdisable。 |
| dependency lock | Missing | repository root | なし | lockfile consistency | `package-lock.json`未commit。 |
| production dependency review/audit | Missing | `package.json`, CI | なし | npm audit / license review evidence | Baseline CIにaudit/review工程なし。 |
| huge import/backup対策 | Missing | `src/pages/MorePage.tsx`, `src/data/validation.ts` | なし | oversized file | `file.text()`→`JSON.parse()`にサイズ上限・streaming保護なし。 |
| unsafe object merge禁止 | Implemented | `src/data/validation.ts`, `src/backup/backup.ts` | なし | prototype pollution negative case | untrusted objectを任意mergeせず個別parser/DB writeを行う。 |
| multi-tab restore/update競合対策 | Missing | 全体 | なし | two-tab concurrency | coordination/lock機構なし。 |
| storage quota / DB open failureのユーザー向け処理 | Partial | `src/pages/PlayPage.tsx`, `src/App.tsx`, `src/pages/RecordsPage.tsx` | なし | quota/db-open error | Playでは一部error表示するがbootstrap/Recordsは`console.error`中心で統一UXなし。 |
| security regression tests | Missing | `tests/**` | なし | XSS/huge input/multitab/quota | security専用testなし。 |

---

# Critical / P0不足項目（優先順位順）

## 1. Critical — ENGINE BUZZ意味論をCurrent Specへ修正

- 対象: `src/engine/typewriterEngine.ts`
- 現状: `buzz()`が`flushScheduledCommitsThrough(buzzAtMs)`を呼び、未presentation-commitのscheduled graphemeをBUZZ時にcatch-up commitする。
- 影響: `buzzIndex`, `buzzRatio`, visibleText, race determinismの意味がCurrent Specからずれる。
- 同時修正必須test: `tests/engine/typewriterEngine.test.ts`。現testは旧catch-up semanticsを正として固定している。

## 2. Critical — responseTimeMsのauthorityをENGINEへ戻す

- 対象: `src/pages/PlayPage.tsx` / ENGINE timing contract
- 現状: React handlerが`performance.now()`で想起時間を直接計測。
- 影響: UI/ENGINE責任境界違反、P0 timing oracle不成立。

## 3. P0 — DATA Question Schema v1へ整合

- 対象: `src/domain/types.ts`, `src/data/validation.ts`, `src/data/db.ts`, `src/data/repositories.ts`, seed/import/backup境界
- 現状: 旧`canonicalAnswer/acceptableAnswers/category/pattern/idealBuzzIndex`形。
- 必須: Current Schema v1、determiningPoints/provenance、canonical import envelope、validation、revision immutability。

## 4. P0 — Kimari-ji / SurvivalをCurrent Spec通り実装

- 対象: `src/modes/strategies.ts`, `src/pages/PlayPage.tsx`, mode tests
- 現状: 両modeをコード上「CORE clarification待ち」としており固有policy未実装。
- 必須: COREで確定済みpolicyに同期し、mode-specific P0 testを追加。

## 5. P0 — Analytics First-Exposure契約修正

- 対象: `src/analytics/kpis.ts`
- 現状: `questionId::revisionId`単位でfirst exposureを算出。
- Current Spec: logical `questionId`単位。revision変更で初見へ戻さない。

## 6. P0 — Persistence / Session / Backup / MigrationのQA oracle追加

- Attempt save→reread exact equality
- Attempt+StudyState transaction commit/rollback
- Session start/end/exhaustion/interruption
- Replace Restore roundtrip/rollback/invalid backup preservation
- DB migration

## 7. P0 — Offline / Mobile / IME / Security受入テスト追加

- offline cold-start + core quiz
- 320px縦画面/no horizontal overflow
- IME composition中Enter
- Enter carry-through防止
- XSS malicious payload
- huge backup/import
- multi-tab update/restore
- storage quota / DB open failure

## 8. P0 — Release reproducibility / evidence

- `package-lock.json`をcommitしrelease inputを固定
- `npm ci`ベースのreproducible verification
- QBT-07 AC-01〜AC-20を証跡付きで全実行
- P0 skipped/flaky/known failure = 0 を確認

---

## 総合結論

- Baseline run #3 4/4 PASSは有効であり、repository/build/test scaffoldの健全性は確認済み。
- ただしPhase 1 Current Specに対しては **NO-GO**。
- 特にENGINE BUZZ semantics、DATA Schema v1、Kimari-ji/Survival、response timing、First-Exposure、P0 QA coverageは修正前にRelease判定へ進めない。
- 本監査commitは文書追加のみとし、機能コードは変更しない。
