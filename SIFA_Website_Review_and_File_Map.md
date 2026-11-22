# SIFA Global Institute — Website Review and File Map

**Source reviewed:** `SIFA_GitHub_Copy.zip` uploaded 20 November 2026. This is a **static source/archive review**, not a live production audit or proof of deployed functionality. **No code, database, or website was changed.**

## Business identity
SIFA Global Institute (Software Institute for Financial Accountants), Malatya, Türkiye; international reach including Rwanda and East Africa. Practical online accounting/business software education. Public-facing slogan in parts of website is **Learn. Practice. Apply.**, while the newer institute description provided by the owner says **Learn. Practice. Grow.** This should be reconciled deliberately, rather than silently replaced.

## Architecture found
- Frontend: static **HTML**, **CSS**, vanilla **JavaScript**; main theme in `styles.css`, shared mobile navigation in `script.js`.
- Assets: `assets/sifa-logo.*`, founder/coordinator photographs, five home images; some duplicated at root and `assets/`.
- Auth/data/storage/backend candidate: **Supabase** (authentication, PostgreSQL, private Storage, Edge Functions), configured via `supabase-config.js` and `supabase/`.
- Deployment documentation refers to **GitHub** and **Vercel**, but the archive by itself does not demonstrate deployed status.
- SQL files include `SIFA-BACKEND-FOUNDATION-DRAFT.sql`, portal/classroom setup scripts, and a Supabase migration. Legacy setup scripts differ and must not be executed indiscriminately.

## Exact page / file map
| Request from owner | Frontend to review/edit | Related logic / server file |
|---|---|---|
| Home, hero, layout, messaging | `index.html`, `styles.css` | `script.js`; images under `assets/home-photos/` |
| About mission/values | `about.html` | `styles.css` |
| Founder and Rwanda coordinator | `founder.html` | `assets/founder-professional.*`, `assets/joseph-professional.*` |
| Available course list | `courses.html` | `supabase-config.js` for admissions toggles; actual backend program allow-list separate |
| Teaching model | `learning.html` | `styles.css` |
| Certificate policy | `certifications.html` | `verify.html`, `verify.js`, certificate admin API |
| Free learning resources | `resources.html` | Links/content, `styles.css` |
| Scholarships info | `scholarships.html`, `student-payments.html` | `sifa-admin.js`, backend and SQL |
| Admissions application | `apply.html` | `student-application.js`, `supabase/functions/public-application/index.ts`, backend SQL |
| Student account/profile | `student-portal.html` | `student-portal.js`, Supabase Auth and database policies |
| Fees/invoices/receipt uploads | `student-payments.html` | `student-payments.js`, `supabase/functions/sifa-student-billing/index.ts`, `submit-payment-receipt/index.ts`, `sifa-admin-api/index.ts` |
| Online classroom, materials, live session | `student-learning.html` | `student-learning.js`, `sifa-learning-access/index.ts`, `sifa-classroom-api/index.ts`, `student-classroom-schema.sql` |
| Staff review of applicants, fees, certificates | `sifa-admin.html` | `sifa-admin.js`, `sifa-admin-api/index.ts` |
| Staff upload PDFs and publish material | `sifa-classroom-manager.html` | `sifa-classroom-manager.js`, `sifa-classroom-api/index.ts` |
| AI assistant | `ai-support.html` | `supabase/functions/sifa-ai-chat/index.ts` and inline page logic |
| Public certificate authenticity lookup | `verify.html` | `verify.js`, certificate RPC in SQL |
| Contact / social profiles | `contact.html`, shared site header/footer | Page links and `styles.css` |
| Privacy | `privacy.html` | actual data handling/hosting requires legal and policy review |
| Search visibility | `sitemap.xml`, `robots.txt`, page meta tags | search-console verification file |
| Shared browser configuration | `supabase-config.js` | browser-safe public project identifier/key, admissions flag, support email |

**Other files:** `apply-backup.html`, `courses-backup.html`, `certifications - backup.html` are older copies; `tatus` is an oddly named file that should be identified before deleting; `.git/` is repository history and not the website code. `README.txt` is an older V1 description; prefer latest implementation and review docs when assessing candidate features.

## What is represented in source
1. Public website with navigation, professional content and responsive CSS.
2. Program catalogue: QuickBooks, Sage, Tally, Excel, Xero, Zoho Books, Odoo, SAP, NetSuite, Dynamics 365, ETA, Logo, Mikro and other future offerings. The displayed program cards are **closed/not open yet**.
3. Application form with personal, educational, scholarship and supporting-document sections; by default admissions are **closed** in browser config and server-oriented setup instructions.
4. Student account creation, sign-in and profile screens.
5. Staff-oriented workflows for application decisions, verified account linking, scholarships, enrollment creation, invoicing, manual receipt approval, certificate issuance/revocation.
6. Student fee information, invoice and receipt forms; protected classroom and staff PDF material manager; certificate lookup and AI support.

## Commercial/business rules as currently written (verify with owner before publishing/updating)
- Public fees page says monthly tuition **10,000 RWF Rwanda**, **US$15 other African countries**, **US$25 rest of world**. Three-month illustrative totals are 30,000 RWF / $45 / $75. Certificate fee **5,000 RWF / $5 / $10** by region. The implementation guide principally documents Rwanda pricing; multi-region consistency needs testing.
- Minimum displayed course duration: three months; monthly billing; due on first of each month; 14-day grace period in technical design.
- Receipt approval is **manual**, not bank gateway validation; uploading a receipt alone does not confirm payment.
- Public payments page contains real recipient/payment-account instructions. **Verify authorization, ownership, correctness, legal compliance and consent before reusing/publishing details. This report intentionally omits numbers.**
- Scholarship requests/approval are separate from ordinary application approval; scholarship discount is for monthly tuition, not certificates.
- Certificates are **SIFA-issued**, not evidence of ACCA or other third-party accreditation.

## Critical safety and readiness notes
- The October 22 implementation review expressly says **not deployed/verified live**: SQL changes, Auth/RLS/Storage policies, Edge Function deployment, staging browser tests, payment verification and production smoke tests were still outstanding.
- `supabase-config.js` has `applicationsOpen: false` and `openPrograms: []`. Never enable admissions before verified server controls, applications, document privacy, staff access boundaries and abuse controls are tested.
- **Do not** execute migration drafts or conflicting old student portal account-deletion SQL against production. Back up, inspect live schema, and test in staging first.
- Keep service-role/secret keys and class links only in secure server-side settings; public publishable/anonymous keys are a different category.
- `apply.html` includes the same Supabase CDN script twice; simplify during a controlled cleanup.
- Public pages repeat navigation/footer markup; edits to navigation may need changes across many HTML files unless refactored into shared components.
- Assets are duplicated in root and `assets/`, making maintenance harder.
- `README.txt` and dated implementation notes describe different stages. Do not assume older notes override the current source.
- Some public pages have weaker search-description coverage (e.g. contact); site-wide accessibility, keyboard behavior, SEO, responsiveness and performance require browser testing.
- Classroom material manager currently handles PDFs up to 20 MB; text announcements, quizzes, automated grading, learner progress tracking and robust video LMS features are not proven by this build.
- No real account sign-in, database/security, payments, email, production deployment, mobile browser, or full integration tests were performed during this review.

## Suggested future direction (proposals, not existing functions)
Phase 1: clarify institute content and credibility, verify public fee details, standardize labels and navigation, fix accessibility/SEO/performance. Phase 2: stage/test and deploy secure core workflows (applications, auth, staff access, payments, classes, certificates). Phase 3: build a full learning platform (course paths, structured lessons, videos, assignments, quizzes, grades, progress, mentor support and dashboards). Phase 4: analytics, email automation, global payment providers and multilingual student journeys, subject to legal/payment/service eligibility.

## Working rules for future edits
- Owner does not need to write code. Translate plain-English requests into affected files and explain consequences.
- Preserve all existing source and branding unless asked otherwise; make targeted changes with backups and test what changed.
- Distinguish source-code existence from operational verification; never claim that a feature works live merely because there is a page or function file.
- Ask for explicit owner approval before changes to pricing, admissions opening, payment recipient information, security/access permissions or production database.
- After edits supply the updated archive or changed files and clear low-code/no-code deployment steps. If the owner shares a revised/current archive, inspect it rather than assuming this copy remains current.
