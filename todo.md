# Project TODO

- [x] Database schema design (projects, analyses, listings, keywords)
- [x] Backend API - Project CRUD operations
- [x] Backend API - Competitor analysis (ASIN data fetch, review analysis, keyword extraction)
- [x] Backend API - Image recognition (OpenAI Vision integration)
- [x] Backend API - Listing generation (title, bullet points, description, keywords, image suggestions)
- [x] Frontend - Global layout and navigation
- [x] Frontend - Dashboard / project list page
- [x] Frontend - New project form (product info input)
- [x] Frontend - Competitor analysis page (ASIN input, results display)
- [x] Frontend - Image recognition page (upload & results)
- [x] Frontend - Listing generation page (generate, preview, edit)
- [x] Frontend - Results preview and export
- [x] Design system - Color palette, typography, theme
- [x] Unit tests for core backend procedures
- [x] Backend - ASIN auto-scraping service (fetch title, bullet points, price, rating, reviews from Amazon)
- [x] Frontend - Simplify competitor analysis page to ASIN-only input with auto-fetch
- [x] Update analysis router to use auto-scraping instead of manual input
- [x] Backend - Batch ASIN analysis API (accept multiple ASINs, process sequentially)
- [x] Frontend - Batch ASIN input (textarea for multiple ASINs, comma/newline separated)
- [x] Frontend - Batch progress display (show per-ASIN status: pending/scraping/analyzing/done/failed)
- [x] Unit tests for batch ASIN analysis
- [x] Update title generation prompt to target 180-200 characters
- [x] Update bullet points generation prompt to target 250-300 characters per bullet
- [x] Add character count display and validation in frontend preview
- [x] Unit tests for character count requirements
- [x] Backend - Manual input analysis API (accept manually pasted product data)
- [x] Frontend - Manual input fallback UI (switch between auto-scrape and manual input modes)
- [x] Frontend - Auto-switch to manual mode on scrape failure with pre-filled ASIN
- [x] Unit tests for manual input analysis
- [x] Create ComparisonPage component for side-by-side ASIN comparison
- [x] Add comparison route to App.tsx and sidebar navigation
- [x] Implement ASIN selector (multi-select from analyzed ASINs)
- [x] Display comparison table: price, rating, brand, title length
- [x] Display keyword comparison (shared vs unique keywords)
- [x] Display pain points / itch points / delight points comparison
- [x] Unit tests for comparison feature (covered by existing 52 tests)
- [x] Backend - AI comparison summary API (accept multiple analysis IDs, generate diff report)
- [x] Add comparison summary LLM prompt (key differences, opportunities, optimization suggestions)
- [x] Frontend - Add AI summary button on ComparisonPage
- [x] Frontend - Display AI summary results with markdown rendering
- [x] Unit tests for AI comparison summary
- [x] Update bullet points character limit from 250-300 to 200-280 (max 280) in backend prompts
- [x] Update bullet points character validation in listing router
- [x] Update bullet points character count display in frontend (GeneratePage, PreviewPage, ComparisonPage)
- [x] Backend - Add file upload endpoint for review Excel/CSV import
- [x] Backend - Parse seller sprite review export format (Excel/CSV)
- [x] Backend - Store imported reviews and link to competitor analysis
- [x] Backend - Trigger AI review analysis on imported reviews
- [x] Frontend - Add review import UI with file drag-and-drop on AnalysisPage
- [x] Frontend - Show imported review count and preview
- [x] Unit tests for review import functionality
- [x] Database - Add reviewImports table to store import history (filename, reviewCount, status, createdAt)
- [x] Backend - API to list review import history for a project
- [x] Backend - API to delete review import record
- [x] Backend - API to re-analyze imported reviews
- [x] Backend - API to append new reviews to existing import (via re-import)
- [x] Frontend - Review import history list with file info, review count, status, date
- [x] Frontend - Actions: view details, re-analyze, delete, append reviews
- [x] Frontend - Import detail view showing parsed reviews
- [x] Unit tests for review import history management (91 tests passing)
- [x] Fix bullet points generation too long - strengthen LLM prompt constraints
- [x] Add stricter character count enforcement in backend validation/retry logic (auto-truncate at 280)
- [x] Update all Listing generation prompts with Ogilvy copywriter expert role persona
- [x] Role: native English speaker, fluent in Chinese, expert in US market, 10+ years at Ogilvy & Mather
- [x] Remove backend auto-truncate logic for bullet points
- [x] Add AI retry mechanism: if generated content exceeds char limits, ask AI to refine/shorten (max 2 retries)
- [x] Strengthen LLM prompts to generate content within exact character ranges
- [x] Backend - Add Chinese translation generation for title, bullet points, description
- [x] Backend - Include Chinese version in listing generation response
- [x] Frontend - Bilingual comparison layout (English left, Chinese right) on GeneratePage
- [x] Frontend - Bilingual comparison layout on PreviewPage
- [x] Store Chinese translations in database alongside English content
- [x] Backend - translateToChinese API for existing listings
- [x] Unit tests for bilingual translation feature (4 tests)
- [x] Database - Add projectFiles table for uploaded analysis files (属性表/竞品Listing/出单词报告/ABA关键词)
- [x] Backend - File upload API for TXT and CSV files with S3 storage
- [x] Backend - TXT parser for 本品属性表.txt (Rufus attribute extraction)
- [x] Backend - TXT parser for 竞品Listing文本.txt (competitor listing text)
- [x] Backend - CSV parser for 竞品出单词报告.csv (COSMO scene mapping)
- [x] Backend - CSV parser for ABA关键词数据.csv (A9 keyword grading)
- [x] Backend - Rufus属性提取分析模块 (extract product attributes as Listing context)
- [x] Backend - 多竞品格局分析模块 (find Parity共性 and Gap缺口)
- [x] Backend - COSMO场景映射模块 (map real usage scenes from search terms)
- [x] Backend - A9关键词分级模块 (grade keywords by weight from ABA data)
- [x] Backend - Integrate four analysis modules into Listing generation flow
- [x] Frontend - DataFilesPage with 4 file upload cards and analysis result display
- [x] Frontend - Analysis module status badges on GeneratePage
- [x] Frontend - Sidebar navigation for 数据文件 page
- [x] Unit tests for file parsing and analysis modules (11 tests)
- [x] Backend - Image advice bilingual (中英文对比) support
- [x] Database - Add imageAdviceCn field to listings table
- [x] Backend - Add updateAnalysisResult API to update file analysis result
- [x] Frontend - Editable analysis result UI for product_attributes (USP, specs, Rufus attributes)
- [x] Frontend - Editable analysis result UI for competitor_listings (parity points, gap opportunities)
- [x] Frontend - Editable analysis result UI for search_term_report (scene clusters, top scenes)
- [x] Frontend - Editable analysis result UI for aba_keywords (title keywords, bullet keywords, golden keywords)
- [x] Frontend - Save/Cancel/Reset controls for each editable section
- [x] Unit tests for analysis result editing (9 tests)
- [x] Feature: File template download - Create 4 standard format template files
- [x] Feature: File template download - Upload templates to CDN
- [x] Feature: File template download - Add download button in each upload card on DataFilesPage
- [x] Feature: Export full report - Backend API to generate comprehensive HTML report
- [x] Feature: Export full report - Include 4 analysis modules + Listing + bilingual comparison
- [x] Feature: Export full report - Frontend export button on PreviewPage with print-to-PDF
- [x] Feature: Analysis version history - Database table (analysisVersions) for storing edit history
- [x] Feature: Analysis version history - Backend API for listing/restoring versions (getVersionHistory, restoreVersion)
- [x] Feature: Analysis version history - Frontend UI with history panel and rollback buttons
- [x] Unit tests for all three new features (10 tests, 126 total passing)
- [x] Feature: Listing Score System - Design scoring algorithm (6 dimensions based on A9 rules)
- [x] Feature: Listing Score System - Backend scoring engine (title optimization, bullet quality, description quality, search terms, keyword coverage, overall SEO)
- [x] Feature: Listing Score System - Backend API endpoint (scoring.scoreListing)
- [x] Feature: Listing Score System - Frontend ScorePage with radar chart, score cards, dimension details, optimization suggestions
- [x] Feature: Listing Score System - Sidebar navigation for Listing评分
- [x] Unit tests for Listing scoring system (11 tests, 137 total passing)
- [x] Feature: Keyword Module - Database schema design (keywords, negativeKeywords tables)
- [x] Feature: Keyword Module - Database migration execution
- [x] Feature: Keyword Module - Backend CRUD API for keywords (add, update, delete, list, bulk import, bulkUpdate)
- [x] Feature: Keyword Module - CSV import for keyword data (西柚找词/卖家精灵 export format, auto column detection)
- [x] Feature: Keyword Module - Three-dimensional scoring (traffic × relevance × competition/SPR auto-classification)
- [x] Feature: Keyword Module - AI semantic filtering (remove non-purchase-intent, generic words)
- [x] Feature: Keyword Module - AI scene tagging (COSMO-aligned scene tags)
- [x] Feature: Keyword Module - Negative keyword library management (add/delete/clear/moveToNegative)
- [x] Feature: Keyword Module - 3D Strategy Matrix generation (7 categories via AI)
- [x] Feature: Keyword Module - Word root classification (7 types via AI)
- [x] Feature: Keyword Module - Listing semantic map & layout suggestions (AI-powered)
- [x] Feature: Keyword Module - Full pipeline (one-click run all AI steps)
- [x] Feature: Keyword Module - Frontend keyword management page with 6 tabs
- [x] Feature: Keyword Module - Frontend 3D strategy matrix visualization
- [x] Feature: Keyword Module - Frontend word root classification view
- [x] Feature: Keyword Module - Frontend negative keyword library UI
- [x] Feature: Keyword Module - Sidebar navigation for 关键词管理
- [x] Unit tests for keyword module (21 tests, 158 total passing)
- [x] Bug fix: Relevance parsing order (极低 before 低)
- [x] Update Listing generation data sources - Keep Rufus attribute extraction from 本品属性表.txt
- [x] Update Listing generation data sources - Multi-competitor analysis now references 竞品对比 comparison results (competitorAnalyses table)
- [x] Update Listing generation data sources - COSMO scene mapping now references keyword module AI scene tags (keywords.sceneTags)
- [x] Update Listing generation data sources - A9 keyword grading now references keyword module 3D strategy matrix and listing layout suggestions (keywords.strategyCategory + listingPlacement)
- [x] Refactored buildProductContext → uses loadEnrichedData instead of loadFileAnalyses
- [x] Unit tests for updated Listing generation data flow (8 tests, 166 total passing)
- [x] DataFilesPage - Remove competitor_listings, search_term_report, aba_keywords upload cards, keep only product_attributes
- [x] Sidebar - Move 关键词管理 nav item above 数据文件
- [x] PreviewPage - Add bilingual (EN/CN) comparison for image advice section
- [x] Backend - translateImageAdviceToChinese function and IMAGE_ADVICE_TRANSLATION_PROMPT
- [x] Backend - imageAdviceCn translation in generateFull and translateToChinese
- [x] Unit tests for UI changes (9 tests, 175 total passing)
- [x] Update IMAGE_ADVICE_PROMPT - Add 10-year design expert Amazon operator role
- [x] Update IMAGE_ADVICE_PROMPT - Add requirements: short attractive titles, clear USP expression, color scheme, composition, data visualization
- [x] Frontend - Display new image advice fields in PreviewPage: title, colorScheme, expressionMethod, dataVisualization, icons
- [x] Frontend - Display designGuidelines section (font, color palette, brand tone, mobile optimization)
- [x] Frontend - Color swatch preview for colorScheme fields
- [x] Frontend - expressionMethod badge in secondary image headers
- [x] Update IMAGE_ADVICE_TRANSLATION_PROMPT to include new fields (colorScheme, expressionMethod, dataVisualization, icons, designGuidelines)
- [x] Unit tests for enhanced image advice fields (8 new tests, 183 total passing)
- [x] Feature: Keyword import - Add XLSX format support (backend parsing with xlsx library)
- [x] Feature: Keyword import - Update frontend file selector to accept .xlsx files
- [x] Feature: Keyword import - Unit tests for XLSX import (6 new tests, 189 total passing)
- [x] Simplify review import: only require ASIN + file upload (remove unnecessary fields)
- [x] Support multi-ASIN review import: allow importing reviews for multiple ASINs simultaneously
- [x] Update review import UI with batch upload interface
- [x] Tests for simplified review import (19 new tests, 208 total passing)
- [x] Feature: Ad keyword structure suggestion - Design data model and AI prompt
- [x] Feature: Ad keyword structure suggestion - Database table and migration
- [x] Feature: Ad keyword structure suggestion - tRPC procedures (generate, get, delete)
- [x] Feature: Ad keyword structure suggestion - Frontend matrix display page with 4 tabs (矩阵视图/广告活动/预算分配/阶段策略)
- [x] Feature: Ad keyword structure suggestion - Integration with existing keyword data
- [x] Feature: Ad keyword structure suggestion - Sidebar navigation (广告架构)
- [x] Feature: Ad keyword structure suggestion - Unit tests (17 new tests, 225 total passing)
- [x] Feature: Ad structure - Integrate competitor analysis data for ASIN targeting recommendations
- [x] Feature: Ad structure - Build competitor summary from competitorAnalyses table (ASIN, brand, price, rating, keywords, review insights)
- [x] Feature: Ad structure - Update AI prompt to generate competitor ASIN targeting campaigns
- [x] Feature: Ad structure - Add update/save tRPC procedure for edited ad structures
- [x] Feature: Ad structure - Frontend inline editing for keywords (add/remove/edit keyword, bid, search volume, competition, notes)
- [x] Feature: Ad structure - Frontend inline editing for campaign settings (budget, bid strategy, optimization tips)
- [x] Feature: Ad structure - Frontend inline editing for auto campaign (budget, bid, harvest strategy)
- [x] Feature: Ad structure - Frontend inline editing for budget allocation (total budget, percentages, amounts, reasons)
- [x] Feature: Ad structure - Frontend inline editing for negative keywords (add/remove per campaign)
- [x] Feature: Ad structure - Frontend save/cancel controls with edit mode banner
- [x] Feature: Ad structure - Unit tests for competitor integration and edit functionality (17 new tests, 242 total passing)
- [x] Feature 1: Competitor ASIN targeting effectiveness estimation module on AdStructurePage
- [x] Feature 1: Backend - scoring algorithm based on rating, review count, price gap, keyword overlap
- [x] Feature 1: Frontend - priority ranking table with score breakdown, recommendation level, and strategy suggestions
- [x] Feature 2: Keyword-Listing linkage - readiness indicator on GeneratePage
- [x] Feature 2: Show AI analysis step completion status (scene tagging, strategy matrix, word root, semantic map)
- [x] Feature 2: Guide users to keyword management page when steps are incomplete
- [x] Feature 3: Keyword export CSV - export filtered keywords from KeywordPage (with BOM for Excel)
- [x] Feature 3: Keyword export CSV - export ad structure keywords from AdStructurePage
- [x] Feature 4: AI optimization on ScorePage - "AI优化" button per dimension + "一键优化最低分项" button
- [x] Feature 4: Backend - LLM-based content optimization for 4 dimensions (title, bullets, description, search terms)
- [x] Feature 4: Frontend - inline optimize buttons on dimension cards and suggestion cards, auto-refetch scores after optimization
- [x] Unit tests for all 4 features (31 new tests, 263 total passing)
- [x] Feature: A/B test versions - Design: no new DB table needed, variants generated on-the-fly and applied to existing listing
- [x] Feature: A/B test versions - Backend AI prompt: 3 style instructions injected into existing title/bullet prompts
- [x] Feature: A/B test versions - Backend generateABTest procedure (3 styles: professional, emotional, data-driven)
- [x] Feature: A/B test versions - Backend applyABVariant procedure with auto Chinese translation
- [x] Feature: A/B test versions - Frontend A/B test card on GeneratePage with 3 style previews
- [x] Feature: A/B test versions - Frontend comparison dialog with tabs (title + bullet points per variant)
- [x] Feature: A/B test versions - Frontend apply variant with loading state and auto-close
- [x] Feature: A/B test versions - Unit tests (22 new tests, 285 total passing)
- [x] Feature: A/B mixed selection - Redesign comparison dialog with browse/mix mode toggle
- [x] Feature: A/B mixed selection - Title selection UI: click to select from any variant, with sub-options
- [x] Feature: A/B mixed selection - Bullet point selection UI: per-bullet pick from any variant with source badges
- [x] Feature: A/B mixed selection - Combined preview panel showing selected title + bullets with source labels
- [x] Feature: A/B mixed selection - Apply mixed logic reuses existing applyABVariant backend (no changes needed)
- [x] Feature: A/B mixed selection - Unit tests (14 new tests, 299 total passing)
- [x] Feature: Ad structure - Add order volume projection module (5 periods: week1-2, week3-4, month2-3, month4-6, month7-12)
- [x] Feature: Ad structure - Add organic ranking milestone estimates (orders needed for page 1 top position)
- [x] Feature: Ad structure - Update AI prompt to generate orderVolumeProjection with adOrders, organicOrders, ACOS, organicRank
- [x] Feature: Ad structure - Frontend "单量预估" tab with period cards, organic ranking milestones, breakeven analysis, assumptions
- [x] Feature: A/B test - Backend: accept optional customStyle param (name + instruction) to generate 4th variant
- [x] Feature: A/B test - Frontend: checkbox toggle for custom style, name input + instruction textarea, dynamic button text
- [x] Feature: A/B test - Mixed selection works with 4 variants (custom style selectable in title/bullet mix)
- [x] Feature: A/B test - Unit tests (13 new tests, 312 total passing)
- [x] Feature: Ad structure - Export Amazon Bulk Sheet Excel (SP ads bulk upload format)
- [x] Feature: Ad structure - Generate Excel with Campaign/Ad Group/Keyword/Match Type/Bid columns
- [x] Feature: Ad structure - Frontend "导出Bulk Sheet" button on AdStructurePage
- [x] Feature: Version history - Database table (listingVersions) for listing content snapshots
- [x] Feature: Version history - Backend API (getVersionHistory, rollbackToVersion)
- [x] Feature: Version history - Auto-save version on generate/AB-apply/optimize/manual-edit
- [x] Feature: Version history - Frontend version history panel on PreviewPage
- [x] Feature: Version history - Version comparison and one-click rollback UI
- [x] Unit tests for Bulk Sheet export and version history features (12 new tests, 324 total passing)
- [x] Bug fix: Keywords in keyword management should not be translated to Chinese - keep original English
- [x] Bug fix: Keywords in ad structure should not be translated to Chinese - keep original English
- [x] Bug fix: Ensure AI prompts do not translate keyword text, only generate structure around them
- [x] Feature: Batch edit - Backend bulkEdit API (batch update strategyCategory, matchType, status, relevance, etc.)
- [x] Feature: Batch edit - Frontend multi-select checkboxes on keyword table
- [x] Feature: Batch edit - Frontend batch action toolbar (appears when keywords selected)
- [x] Feature: Batch edit - Batch set strategy category, match type, status, relevance, traffic level
- [x] Feature: Batch edit - Select all / deselect all / invert selection
- [x] Feature: Dedup detection - Backend dedup logic during CSV/XLSX import (case-insensitive match)
- [x] Feature: Dedup detection - Merge strategy: keep existing keyword data, update missing fields from new import
- [x] Feature: Dedup detection - Frontend dedup summary after import (X new, Y duplicates merged, Z skipped)
- [x] Unit tests for batch edit and dedup detection features (17 new tests, 348 total passing)
- [x] Change: Review import - Remove manual ASIN input requirement
- [x] Change: Review import - Auto-extract ASIN from uploaded review spreadsheet
- [x] Change: Review import - Auto-match extracted ASINs to existing competitor analyses
- [x] Change: Review import - Simplify frontend UI (just upload file, no ASIN field)
- [x] Unit tests for updated review import auto-ASIN matching (9 new tests, 357 total passing)
- [x] Change: Traffic level classification - Replace fixed thresholds with AI-based smart classification (高/中/低) based on overall monthly search volume distribution
- [x] Change: Competition level classification - Replace fixed thresholds with AI-based smart classification (低/中/高) based on overall SPR distribution
- [x] Unit tests for AI-based traffic and competition classification (12 new tests, 370 total passing)
- [x] Change: Listing generation - Competitor analysis module should reference competitor analysis results instead of re-generating
- [x] Change: Listing generation - COSMO scene mapping should reference keyword scene tagging results
- [x] Change: Listing generation - A9 keyword grading should reference 3D strategy matrix and Listing placement suggestions
- [x] Change: Listing export report - Update four analysis modules to display referenced data
- [x] Unit tests for referenced analysis data in listing generation (12 new tests, 382 total passing)
- [x] Change: Listing AI prompt - Inject real competitor analysis data (from competitorAnalyses table) into generation prompt
- [x] Change: Listing AI prompt - Inject keyword scene tags (COSMO) into generation prompt
- [x] Change: Listing AI prompt - Inject 3D strategy matrix and listing placement suggestions into generation prompt
- [x] Change: Listing AI prompt - Replace file-only data sources with combined file + module data
- [x] Unit tests for listing prompt with real module data injection (12 new tests, 394 total passing)
- [x] Feature: Listing generation - Add "emphasis" option for users to specify key selling points or scenes to highlight
- [x] Feature: Listing generation - Backend: accept emphasis text and inject into AI prompt for all 6 generation endpoints
- [x] Feature: Listing generation - Frontend: add emphasis textarea on GeneratePage before generate button
- [x] Change: Scoring system - Replace ABA file data source with keyword management module data
- [x] Change: Scoring system - scoreKeywordCoverage now uses keywordsByPlacement and keywordsByStrategy from keywords table
- [x] Change: Scoring system - scoring.ts router loads keywords from keywords table via loadKeywordsFromModule helper
- [x] Change: Scoring system - All ABA references in messages replaced with keyword management module references
- [x] Unit tests for emphasis option and scoring data source changes (7 new tests, 401 total passing)
- [x] Feature: Review aggregation analysis - Aggregate all competitor reviews using Kano model (pain points/itch points/delight points)
- [x] Feature: Review aggregation analysis - Backend AI analysis with Kano model classification
- [x] Feature: Review aggregation analysis - Results are editable and adjustable
- [x] Feature: Review aggregation analysis - Edited results feed into Listing generation multi-competitor analysis (buildProductContext updated)
- [x] Feature: Keyword module - Make relevance/traffic/competition fields manually adjustable (dropdown select high/medium/low)
- [x] Feature: Keyword module - Make strategyCategory field manually selectable (dropdown from predefined options)
- [x] Feature: Keyword module - Make rootType field manually selectable (dropdown)
- [x] Feature: Keyword module - Make listingPlacement field manually selectable (dropdown)
- [x] Feature: Listing generation flow - Step 1: Generate selling point core content first (generateSellingPointsCores API)
- [x] Feature: Listing generation flow - Step 2: User confirms/edits selling point cores (editable FABE direction, theme, keywords)
- [x] Feature: Listing generation flow - Step 3: Generate bullet points one by one after confirmation (generateSingleBullet API)
- [x] Feature: Listing generation flow - Keep existing prompts, 4-module references, and generation requirements unchanged
- [x] Unit tests for review aggregation, keyword field editing, and listing generation flow changes (15 new tests, 416 total passing)
- [x] Feature: Add sync button to step-by-step bullet generation - sync confirmed bullets to Listing preview page
- [x] Feature: Backend API (syncBulletsFromSellingPoints) - update/create listing bulletPoints from confirmed selling point bullets
- [x] Feature: Frontend sync button with loading state and success toast feedback
- [x] Feature: Keyword table batch edit dropdown fields - already implemented with 7 batch dropdown selectors (strategy/relevance/status/placement/rootCategory/trafficLevel/competition)
- [x] Unit tests for bullet sync feature (4 new tests, 420 total passing)
- [x] Feature: ReviewAggregationPage - Add ASIN filter dropdown to filter Kano points by source ASIN
- [x] Feature: ReviewAggregationPage - Add severity/importance sorting for pain/itch/delight points
- [~] Feature: Step-by-step bullet generation - Save draft (CANCELLED by user)
- [~] Feature: Step-by-step bullet generation - Restore draft (CANCELLED by user)
- [x] Feature: ScorePage - Add keyword coverage detail panel (expandable, show covered/missing keywords with green/red badges)
- [x] Feature: ScorePage - Backend: coveredKeywords and missingKeywords added to ScoreDetail interface
- [x] Unit tests for keyword coverage detail panel (3 new tests, 423 total passing)
- [x] Feature: Keyword import - Fix header mapping: 流量词/搜索词 mapped to keyword field
- [x] Feature: Keyword import - Extract 关键词翻译 column as translationCn field
- [x] Feature: Keyword import - Extract AC推荐 column as isAcRecommended field
- [x] Feature: Keywords table - translationCn (translation_cn) and isAcRecommended (is_ac_recommended) columns added
- [x] Feature: Keyword UI - Chinese translation column displayed in keyword table
- [x] Feature: Keyword UI - AC star icon for AC recommended keywords
- [x] Feature: Negative keywords - reasonCn (reason_cn) column added, Chinese reasons auto-mapped
- [x] Feature: Negative keywords - Filter by rejection reason dropdown
- [x] Feature: Negative keywords - Batch restore from negative library with skipSemanticFilter flag
- [x] Feature: Strategy matrix - brand_offensive strategy category added
- [x] Feature: Root classification - brand_competitor root category added
- [x] Feature: Ad strategy - Offensive campaign added to ad structure prompt
- [x] Unit tests for keyword module improvements (14 new tests, 437 total passing)
- [x] Bugfix: KeywordPage - Fix 4 TS errors: split keyword.ts (1026 lines) into keywordCrud.ts + keywordAi.ts + keywordHelpers.ts, register as separate sub-routers (trpc.keyword + trpc.keywordAi), update frontend references, all 437 tests passing

## 知识库模块 (Knowledge Base Module)

### 基础设施
- [x] Database schema: 6个知识库表 (kb_product_innovations, kb_listing_copywriting, kb_image_sets, kb_images, kb_operation_skills, kb_videos) + 19个模块一表 (dev_*)
- [x] Install file parsing dependencies (mammoth, pdf-parse, officeparser)
- [x] Backend: File parser utilities (PDF, Word, Excel, PPT, Markdown, images) in kbSkills router
- [x] Backend: Scraper integration for knowledge base (reuse existing scraper.ts)

### 智能产品创意库
- [x] Backend: kbProducts router (CRUD, ASIN/link import, batch ASIN import, AI analysis, confirm)
- [x] Backend: AI prompt for product innovation analysis
- [x] Frontend: KBProductsPage (ASIN/URL input, batch import, AI analysis display, edit, confirm, browse)

### 智能Listing文案库
- [x] Backend: kbListings router (CRUD, ASIN/link import, batch ASIN import, AI analysis, confirm)
- [x] Backend: AI prompt for listing copywriting analysis
- [x] Frontend: KBListingsPage (ASIN/URL input, batch import, AI analysis display, edit, confirm, browse)

### 智能图片知识库
- [x] Backend: kbImages router (CRUD, ASIN import, batch ASIN import, AI visual analysis, auto-tagging, confirm)
- [x] Backend: AI prompt for visual analysis + 4-dimension auto-tagging (category/colorScheme/imageType/designStyle)
- [x] Frontend: KBImagesPage (ASIN input, batch import, waterfall layout, 4-dimension filter, tag editing, confirm)

### 智能运营SOP知识库
- [x] Backend: kbSkills router (CRUD, URL import, file upload/parse, batch file import, AI summary, confirm)
- [x] Backend: Multi-format file parser (PDF via pdf-parse, Word via mammoth, Excel/PPT/mindmap via officeparser, Markdown, images via LLM)
- [x] Backend: AI prompt for document summary and key information extraction
- [x] Frontend: KBSkillsPage (URL/file input, batch file import with drag-drop, AI summary display, edit, confirm, browse, search)

### 智能视频知识库
- [x] Backend: kbVideos router (CRUD, video URL/ASIN/batch import, audio transcription via Whisper, AI analysis, confirm)
- [x] Backend: AI prompt for video analysis (golden 3 seconds, script structure, conversion anchors)
- [x] Frontend: KBVideosPage (video URL/ASIN/batch input, transcription display, AI analysis display, edit, confirm, browse)

### 跨模块检索
- [x] Backend: kbSearch router with cross-module search API (searchKnowledgeBase in kbDb.ts) + stats aggregation

### 导航与布局
- [x] Sidebar: Two-level navigation (module rail + feature menu) with 5 modules
- [x] Routes: All module routes registered in App.tsx (dev/*, listing/*, knowledge/*, ops/*, service/*)
- [x] PlatformHome: Landing page with 5 module cards
- [x] ComingSoonPage: Placeholder for module 3 (智能运营提效) and module 4 (智能售后管理)

## Bugfix & Enhancement (2026-03-13)
- [x] Bugfix: 模块一（产品开发）在前台页面已正确展示 - 导航和路由配置正确
- [x] Enhancement: 所有模块名称已统一加上"智能"前缀（智能产品开发、智能Listing生成、智能运营提效、智能售后管理、智能知识库）

## 模块一 - 智能产品开发分析 (Module 1)
- [x] Database: 19张dev_*表 (devProjects, devUploadedFiles, devProducts, devReviews, devTagDimensions, devExternalData, devAnalysisReports, devProjectScores, devProductProfiles, devBomItems, devProfitCalculations, devGlobalSuppliers, devProductManuals, devTestReports, devSuppliers, devMoldCosts, devTimePlans, devBomSummary)
- [x] Backend: devDb.ts database helpers (25+ functions)
- [x] Backend: devProject router (CRUD, stats, file upload)
- [x] Backend: devTagging router (AI smart tagging, dimension management)
- [x] Backend: devAnalysis router (AI report generation, external data, review analysis)
- [x] Backend: devScoring router (6-dimension AI scoring)
- [x] Backend: devProfile router (8 sub-module product profile with AI suggestions)
- [x] Backend: devBom router (BOM management, profit calculator, suppliers)
- [x] Backend: devManual router (product manual + test report AI generation)
- [x] Frontend: DevDashboard (stats cards, recent projects, quick actions)
- [x] Frontend: DevProjects / DevProjectList (search, filter, status management)
- [x] Frontend: DevNewProject (creation form)
- [x] Frontend: DevProjectDetail (7 tabs: overview, profile, BOM, manual, test report, analysis, scoring)
- [x] Frontend: DevCompare, DevProfitCalculator, DevSupplierLibrary, DevTagSettings (standalone pages)
- [x] Unit tests: 496 total tests passing (30 test files)

## 图片建议功能拆分 (Image Suggestion Split - 2026-03-13)
- [x] Navigation: Add "智能图片建议" menu item below "Listing评分" in DashboardLayout
- [x] Route: Add /listing/image-suggestions route in App.tsx
- [x] Frontend: Create standalone ImageSuggestionsPage with bilingual (EN/CN) side-by-side layout
- [x] Frontend: Add enhanced fields display (FABE analysis, shooting notes, data visualization, icons, design guidelines)
- [x] Frontend: Add "生成图片建议" button that calls generateImageAdvice independently
- [x] Frontend: Add "生成中文翻译" button for image advice translation
- [x] Backend: Ensure generateImageAdvice works independently (not tied to full listing generation)
- [x] AI Prompt: Update IMAGE_ADVICE_PROMPT with enhanced JSON structure (shootingNotes for mainImage, FABE for secondary images, enhanced A+ content fields)
- [x] AI Prompt: Update IMAGE_ADVICE_TRANSLATION_PROMPT to match new structure
- [x] Unit tests for image suggestion split feature (15 new tests, 511 total passing)

## 图片建议增强功能 (Image Suggestion Enhancements - 2026-03-13)
- [x] Test: 测试实际生成效果，验证FABE分析、配色方案等新字段是否符合预期
- [x] Feature: 图片建议页面增加“导出为PDF”功能，方便将建议发给设计师
- [x] Feature: A+内容模块增加拖拽排序功能，方便调整模块顺序

## 图片建议5步工作流重构 (5-Step Image Workflow - 2026-03-13)
### DB & Schema
- [x] DB: 创建 image_workflow_sessions 表（工作流会话+步骤状态+每步数据JSON）

### Step 1: 卖点梳理（AI生成+人工编辑确认）
- [x] Backend: AI卖点梳理prompt+生成接口（输入竞品ASIN/Listing+产品画像）
- [x] Backend: 卖点编辑保存+确认接口
- [x] Frontend: Step1页面（AI生成→可编辑卡片：主卖点≤2个、次要卖点、好评点、差评点、必要性描述、场景及占比→确认按钮）

### Step 2: 图片大纲（AI生成+人工编辑确认）
- [x] Backend: AI图片大纲prompt+生成接口（基于确认的卖点）
- [x] Backend: 大纲编辑保存+确认接口
- [x] Frontend: Step2页面（每张图做什么内容、呼应哪个卖点、含品牌故事和A+→可编辑→确认）

### Step 3: 风格确认（AI推荐+人工选择确认）
- [x] Backend: AI风格推荐prompt+生成接口（根据类目和颜色推荐套图描述）
- [x] Backend: 风格选择确认接口
- [x] Frontend: Step3页面（展示AI推荐的几个风格方案→选择1-2个→确认）

### Step 4: 参考图确认（AI推荐+人工确认）
- [x] Backend: AI参考图推荐prompt+生成接口（构图参考优先知识库，效果图优先套图）
- [x] Backend: 参考图确认接口
- [x] Frontend: Step4页面（每张图的构图参考+效果图参考→可编辑→确认）

### Step 5: 图片结构及内容建议
- [x] Backend: 综合生成图片建议接口（基于大纲+参考图+风格）
- [x] Backend: 最终建议编辑保存+确认接口
- [x] Frontend: Step5结果页面（中英文左右展示，可编辑，含PDF导出和A+拖拽排序）
- [x] Feature: PDF导出功能
- [x] Feature: A+内容拖拽排序

### 整体
- [x] 导航更新：智能图片建议改为步骤式工作流
- [x] 步骤进度条/导航组件
- [x] 每步均含人工编辑确认交互 (562测试全部通过)

## Step4知识库图片选择器 (KB Image Picker for Step4 - 2026-03-13)
- [x] Backend: 新增知识库图片查询API供Step4使用（支持按类目/色系/图片类型/设计风格筛选）
- [x] Frontend: Step4增加“从知识库选择参考图”按钮和图片选择器弹窗
- [x] Frontend: 图片选择器支持4维筛选（类目/色系/图片类型/设计风格）+ 网格展示
- [x] Frontend: 选中的知识库图片作为参考图关联到对应图片（缩略图展示+删除）
- [x] Unit tests for KB image picker feature (574测试全部通过)

## Step4测试+Step3知识库图片+导出完整方案 (2026-03-13)
- [x] Test: 实际测试Step4知识库选图功能（知识库无数据时显示空状态，等待导入图片后测试）
- [x] Feature: Step3风格确认增加知识库图片参考（让AI推荐的风格方案可关联实际知识库套图）
- [x] Feature: Step3增加“从知识库选择参考套图”按钮和图片选择器
- [x] Feature: Step3选中的知识库套图展示在风格方案卡片中
- [x] Feature: 5步工作流增加“导出完整方案”功能
- [x] Feature: 导出方案整合5步结果为完整图片设计方案文档
- [x] Feature: 导出方案包含卖点梳理、图片大纲、风格参考、参考图、最终图片建议
- [x] Unit tests for Step3 KB images and export feature (594测试全部通过)

## Step5图片微调+PDF导出 (Image Fine-tune + PDF Export - 2026-03-13)
- [x] Backend: 新增单张图片微调AI接口（refineSingleImage），接收图片类型、当前内容、用户修改指令，返回微调后的结果
- [x] Backend: 微调AI提示词（保持整体风格一致，仅修改用户指定的文字/布局部分）
- [x] Backend: PDF导出通过前端浏览器打印功能实现（无需后端接口）
- [x] Frontend: Step5每张图片卡片增加“微调”按钮（主图/辅图/A+模块均有）
- [x] Frontend: RefinePopover弹窗（含6个快捷操作+自定义指令输入）
- [x] Frontend: 微调结果实时替换到对应图片卡片中（英文+中文同步更新）
- [x] Frontend: 导出完整方案同时提供HTML导出和PDF导出两个按钮
- [x] Tests: 编写微调和PDF导出相关测试 (608测试全部通过)

## Step5微调锁定功能 (Refine Lock Feature - 2026-03-13)
- [x] Backend: 更新refineSingleImage接口，新增lockedFields参数（锁定的字段列表）
- [x] Backend: AI提示词中明确标注锁定字段，要求AI保持这些字段完全不变
- [x] Frontend: RefinePopover增加"锁定元素"区域，列出当前图片的可锁定字段
- [x] Frontend: 每个可锁定字段旁增加锁定/解锁切换按钮（Lock/Unlock图标）
- [x] Frontend: 锁定字段以视觉高亮方式展示（如锁图标+灰色背景）
- [x] Frontend: 发送微调请求时携带lockedFields参数
- [x] Frontend: 微调结果返回后，验证锁定字段是否保持不变（前端兜底覆盖）
- [x] Tests: 编写锁定功能相关测试 (626测试全部通过)

## Listing生成流程调整 (Listing Generation Flow Adjustment - 2026-03-13)
- [x] 后端: 调整卖点精雕AI生成从5条增加到7条
- [x] 后端: 支持用户手动增加最多2条卖点（总计最多9条）
- [x] 后端: 调整翻译流程（编辑确认后再翻译，而非自动翻译）
- [x] 前端: Listing生成页面只保留分步卖点精雕核心方向
- [x] 前端: 卖点精雕页面支持编辑+确认交互
- [x] 前端: 确认后发送到结果预览页面
- [x] 前端: 结果预览页面卖点显示增加到9条
- [x] 前端: 结果预览页面增加编辑功能
- [x] 前端: 编辑确认后执行中英文翻译
- [x] 前端: 翻译完成后传到Listing评分页面
- [x] Tests: 编写相关测试 (628测试全部通过)

## 手动卖点AI辅助生成 (Manual Selling Point AI Assist - 2026-03-13)
- [x] 后端: 新增expandKeywordToFABE tRPC接口（输入关键词/主题，输出FABE格式卖点）
- [x] 后端: AI提示词设计（基于产品上下文+关键词生成subtitle+fullText）
- [x] 前端: GeneratePage手动添加卖点区域增加AI辅助生成交互
- [x] 前端: 关键词输入框+AI生成按钮+加载状态
- [x] 前端: AI生成结果可编辑后确认添加
- [x] Tests: 编写相关测试 (641测试全部通过)

## 卖点精雕关键词导入 (Keyword Import for Selling Points - 2026-03-14)
- [x] 后端: 确认关键词查询接口可用（按项目ID获取关键词列表）
- [x] 前端: 在卖点精雕步骤增加"从关键词导入"按钮
- [x] 前端: 关键词选择弹窗（支持搜索、筛选、多选）
- [x] 前端: 选中关键词后自动填入AI辅助生成的关键词输入框
- [x] 前端: 支持批量选择关键词一次性导入
- [x] Tests: 编写相关测试 (657测试全部通过)

## 关键词导入弹窗排序功能 (Keyword Import Sort - 2026-03-14)
- [x] 前端: 关键词导入弹窗增加按月搜索量升序/降序排序按钮
- [x] Tests: 更新相关测试 (663测试全部通过)

## 模块一智能产品开发重构 (Module 1 Optimization - 2026-03-15)

### Phase 1: 数据库Schema扩展 + 数据解析增强
- [x] DB: devProducts表扩展字段(monthlyRevenue/listingDate/fulfillment/sellerName/sellerLocation/variantCount/category/monthlyRevenueHistory/specifications/description)
- [x] DB: devReviews表扩展字段(isVine/hasImage/hasVideo/reviewerName)
- [x] DB: 新增dev_analysis_stages表(阶段状态管理)
- [x] DB: 新增dev_product_tags表(产品属性标签)
- [x] 后端: 增强Excel解析逻辑-搜索销量数据完整字段映射
- [x] 后端: 增强Excel解析逻辑-标题五点数据详细参数提取
- [x] 后端: 增强Excel解析逻辑-评论数据完整字段映射
- [x] 后端: 增强Excel解析逻辑-历史销量数据双Sheet解析(销量+销售额)
- [x] 后端: 分析阶段CRUD接口(create/get/update/confirm)

### Phase 1续: AI属性标注系统
- [x] 后端: AI属性标注提示词(从标题+五点提取品类属性维度和值)
- [x] 后端: 属性标注tRPC接口(generateTags/updateTag/confirmTags)
- [x] 前端: 属性标注审核UI(矩阵表格+下拉编辑+批量确认)

### Phase 2: 市场大盘分析
- [x] 后端: 市场大盘统计计算引擎(总销额/总销量/均价/中位价/ASIN数/新品占比)
- [x] 后端: 月度趋势计算(基于历史销量聚合)
- [x] 后端: 季节性指数计算
- [x] 后端: AI市场解读提示词(成熟度/趋势/进入时机)
- [x] 前端: 市场大盘分析页面(数据表格+趋势图+季节性图+AI解读+编辑确认)

### Phase 2续: 产品属性交叉分析
- [x] 后端: 单维度属性分组统计(销额/销量/ASIN数/均价/均评分)
- [x] 后端: 双维度交叉矩阵计算
- [x] 后端: 热门属性组合排名
- [x] 后端: 蓝海识别算法(低竞争高需求)
- [x] 后端: AI产品策略提示词(主流形态/差异化机会/推荐方向)
- [x] 前端: 属性交叉分析页面(分布图+热力图+气泡图+AI建议+编辑确认)

### Phase 3: 价格段分析 + 品牌竞争分析
- [x] 后端: 价格区间自动划分+统计
- [x] 后端: 价格×属性交叉分析
- [x] 后端: AI定价策略提示词
- [x] 后端: 品牌份额计算(TOP10/CR3/CR5/CR10)
- [x] 后端: 中国vs非中国卖家分析
- [x] 后端: 品牌月度趋势计算
- [x] 后端: 品牌产品地图生成
- [x] 后端: AI品牌竞争策略提示词
- [x] 前端: 价格段分析页面(分布图+交叉矩阵+AI建议+编辑确认)
- [x] 前端: 品牌竞争分析页面(份额图+趋势图+产品地图+AI策略+编辑确认)

### Phase 4: 评论深度分析 + 综合决策看板
- [x] 后端: 评论统计计算(评分分布/VP占比/时间趋势)
- [x] 后端: AI卡洛模型分析提示词(痛点/痒点/爽点)
- [x] 后端: 竞品评论聚合分析
- [x] 后端: 综合决策评分计算(基于确认数据)
- [x] 后端: AI综合决策提示词(产品定位/SWOT/上新计划)
- [x] 前端: 评论深度分析页面(评分分布+卡洛模型+主题分析+编辑确认)
- [x] 前端: 综合决策看板页面(评分卡+产品定位+SWOT+上新计划+编辑确认)

### 阶段化流程UI
- [x] 前端: 项目详情页重构为阶段化分析流程(进度指示器+阶段导航)
- [x] 前端: 统一的阶段分析组件(数据区+AI解读区+操作栏)
- [x] 前端: 确认锁定机制(状态管理+返回修改提示)
- [x] Tests: 编写相关测试 (685测试全部通过)

## 模块一站外分析功能 (Off-Site Analysis - 2026-03-15)

### 数据库 + 后端基础
- [x] DB: 新建dev_offsite_analyses表（站外分析任务管理，含sourceType/keyword/status/rawData/aiAnalysis/editedAnalysis/confirmed）
- [x] DB: 迁移已执行（dev_offsite_analyses表已创建）
- [x] 后端: 站外数据抓取服务层（YouTube/TikTok/Reddit/SimilarWeb Data API对接）
- [x] 后端: Google Trends抓取与分析接口
- [x] 后端: YouTube/TikTok KOL内容抓取与分析接口
- [x] 后端: Facebook竞品推广抓取与分析接口
- [x] 后端: 独立站竞品调研抓取与分析接口（SimilarWeb集成）
- [x] 后端: Reddit帖子及评论抓取与分析接口
- [x] 后端: 众筹网站新品趋势抓取与分析接口
- [x] 后端: AI站外分析提示词（7个数据源+综合总结共8个专业分析提示词）

### 前端
- [x] 前端: DevOffsiteAnalysis主页面（7个数据源左侧导航+搜索+结果列表）
- [x] 前端: Google Trends分析（关键词输入+AI解读+编辑确认）
- [x] 前端: YouTube/TikTok分析（关键词输入+AI解读+编辑确认）
- [x] 前端: Facebook分析（关键词输入+AI解读+编辑确认）
- [x] 前端: 独立站分析（URL/关键词输入+SimilarWeb数据+AI解读+编辑确认）
- [x] 前端: Reddit分析（关键词输入+AI解读+编辑确认）
- [x] 前端: 众筹网站分析（关键词输入+AI解读+编辑确认）

### 导航调整
- [x] 前端: 调整项目详情页导航顺序（概览→数据管理→站外分析→分析报告→产品画像→评分→BOM→说明书→测试报告）
- [x] 前端: 站外分析路由注册（/dev/project/:id/offsite）

### 测试
- [x] Tests: 编写站外分析相关测试（16个测试：提示词、Schema、路由、DB helpers、集成）
- [x] 后端: 使用用户提供的Reddit分析提示词（市场研究分析师角色+痛点/需求/客户语言分析）
- [x] 全部701个测试通过

## 项目管理两阶段重构 (2026-03-15)

### 架构重构
- [x] 重构项目详情页为两大阶段：市场分析阶段 + 项目落地阶段
- [x] 第一阶段（市场分析）：数据管理 + 7阶段分析 + 站外分析 + 评分立项
- [x] 第二阶段（项目落地）：产品画像 + BOM表 + 说明书 + 测试报告 + 利润计算器 + 报告下载
- [x] 评分页面增加"确定立项"功能，立项后进入第二阶段

### 数据库变更
- [x] DB: dev_projects表增加phase/approvedAt/approvedScore等立项状态字段
- [x] DB: dev_product_profiles表重构为8子模块（外观设计/功能提升/产品成本/包装设计/包装外观/用户画像/使用场景/产品地图）
- [x] DB: dev_test_reports表增加testStatus(通过/未通过/待测)和actualResult字段
- [x] DB: dev_manuals表增加spanishContent和brandAssets字段

### 后端：立项流程
- [x] 后端: 立项API（approveProject + revokeApproval）- 评分页确认/撤销立项
- [x] 后端: 项目阶段状态管理（market_analysis → project_execution）

### 后端：产品画像8子模块
- [x] 后端: 外观设计子模块AI生成+CRUD
- [x] 后端: 功能提升子模块AI生成+CRUD
- [x] 后端: 产品成本子模块AI生成+CRUD
- [x] 后端: 包装设计子模块AI生成+CRUD
- [x] 后端: 包装外观子模块AI生成+CRUD
- [x] 后端: 用户画像子模块AI生成+CRUD
- [x] 后端: 使用场景子模块AI生成+CRUD
- [x] 后端: 产品地图子模块AI生成+CRUD
- [x] 后端: 各子模块确认后永久保留，供其他模块提取数据

### 后端：说明书生成模块
- [x] 后端: AI生成9章节说明书内容
- [x] 后端: 品牌素材上传（Logo/封面底图/二维码）
- [x] 后端: 生成英文/西班牙语双版本HTML说明书
- [x] 后端: PDF导出功能

### 后端：测试报告模块
- [x] 后端: AI生成8类测试项目（安装/使用/跌落/运输/功能/耐久性/安全/包装）
- [x] 后端: 每项包含中英文描述、测试要求、通过标准和测试方法
- [x] 后端: 状态管理（通过/未通过/待测）和实际测试结果填写
- [x] 后端: Excel导出功能

### 后端：BOM联动利润计算器
- [x] 后端: BOM成本汇总自动填入利润计算器"产品成本"字段
- [x] 后端: 批量模拟（100/500/1000/5000件）模具分摊成本变化
- [x] 后端: 不同订单量对应利润率对比表

### 后端：报告下载
- [x] 后端: 一键生成完整项目报告（分析报告+产品画像+BOM表汇总，HTML格式可打印为PDF）

### 前端：两阶段UI重构
- [x] 前端: 项目详情页两阶段Tab重构（市场分析5Tab | 项目落地6Tab）
- [x] 前端: 评分页增加"确定立项"按钮+撤销立项功能
- [x] 前端: 立项后项目落地阶段解锁，未立项显示锁定提示

### 前端：产品画像8子模块
- [x] 前端: 外观设计子模块页面（AI生成+编辑+确认锁定）
- [x] 前端: 功能提升子模块页面
- [x] 前端: 产品成本子模块页面
- [x] 前端: 包装设计子模块页面
- [x] 前端: 包装外观子模块页面
- [x] 前端: 用户画像子模块页面
- [x] 前端: 使用场景子模块页面
- [x] 前端: 产品地图子模块页面

### 前端：说明书生成
- [x] 前端: 三步流程UI（AI生成9章节→编辑确认→双语HTML/PDF导出）
- [x] 前端: 品牌素材管理（Logo/封面底图/二维码）
- [x] 前端: PDF导出按钮（英文+西班牙语）

### 前端：测试报告
- [x] 前端: 8类测试项目分类展示（安装/使用/跌落/运输/功能/耐久性/安全/包装）
- [x] 前端: 状态追踪（通过/未通过/待测）下拉选择
- [x] 前端: 统计面板（总数/通过/未通过/待测）
- [x] 前端: Excel(CSV)导出按钮

### 前端：BOM联动利润计算器
- [x] 前端: BOM成本自动填入利润计算器（产品成本+模具总费）
- [x] 前端: 批量模拟对比表（100/500/1000/5000件，含模具分摊/单件成本/利润率/ROI/总利润）

### 前端：报告下载
- [x] 前端: 一键下载完整项目报告（HTML格式，含评分/竞品/画像/BOM汇总，可浏览器打印为PDF）

### 测试
- [x] Tests: 两阶段Schema测试（19个测试全部通过）
- [x] Tests: 立项流程路由测试
- [x] Tests: 产品画像8子模块配置测试
- [x] Tests: 说明书9章节配置测试
- [x] Tests: 测试报告8类别+状态测试
- [x] Tests: 利润模拟计算逻辑测试
- [x] 全部720个测试通过

## 三项增强功能 (2026-03-15)

### 产品画像富文本编辑器
- [x] 前端: 为每个子模块增加富文本编辑器（textarea+字符计数+复制AI建议）
- [x] 前端: 编辑后内容可保存为用户自定义版本
- [x] 前端: 确认锁定时使用编辑后的最终版本

### 利润计算器汇率换算
- [x] 后端: 汇率查询API（er-api.com实时汇率+fallback）
- [x] 前端: 利润计算器增加汇率显示卡片（数据源+更新时间+可手动调整）
- [x] 前端: 产品成本(¥)和模具费(¥)自动换算为美元参与利润计算

### 项目列表阶段筛选
- [x] 前端: 项目列表增加阶段统计卡片（全部/市场分析/项目落地，可点击快速筛选）
- [x] 前端: 增加阶段筛选下拉框+项目卡片阶段标签（蓝色市场分析/绿色项目落地）+已立项对号图标
- [x] Tests: 18个增强功能测试通过，全部738个测试通过

## 标签管理迁移到项目内 (2026-03-15)

### 数据库
- [x] DB: 新建dev_project_tag_categories表（项目级标签分类，含projectId/categoryKey/categoryName/confirmed/sortOrder）
- [x] DB: 新建dev_project_tag_items表（标签项，含categoryId/projectId/tagName/tagValue/source）
- [x] DB: 标签与项目关联（projectId字段），每个标签仅在本项目中使用

### 后端
- [x] 后端: AI生成标签API（全部生成+单分类生成，14个接口）
- [x] 后端: 标签分类CRUD（initCategories/getCategories/updateCategoryName/addCategory/deleteCategory）
- [x] 后端: 标签项CRUD（addTagItem/updateTagItem/deleteTagItem）
- [x] 后端: 标签确认API（confirmCategory/unconfirmCategory/confirmAll）
- [x] 后端: 获取项目标签状态API（getTagStatus: total/confirmed/allConfirmed/initialized）

### 前端
- [x] 前端: ProjectTagManager组件（7类标签可展开卡片+状态统计栏）
- [x] 前端: 标签分类名称可编辑（inline编辑+保存/取消）
- [x] 前端: 标签项增删改操作（手动添加+编辑+删除+AI/手动来源标记）
- [x] 前端: AI生成按钮（全部生成+单分类生成+加载状态）
- [x] 前端: 确认锁定流程（单分类确认/解锁+全部确认）
- [x] 前端: 状态统计显示是否可进入分析（总数/已确认/待确认）

### 导航
- [x] 前端: 项目详情页第一阶段增加"标签管理"Tab（数据管理和分析报告之间，6列布局）
- [x] 前端: 标签状态统计显示是否可进入分析

### 测试
- [x] Tests: 14个标签管理测试通过（Schema/默认分类/路由/确认流程/集成）
- [x] 全部752个测试通过

## 标签批量导入功能 (2026-03-15)

### 后端
- [x] 后端: parseImportFile接口（CSV解析+自动列映射检测+数据预览）
- [x] 后端: 自动检测文件列结构（支持中文/英文/混合列名+智能fallback）
- [x] 后端: batchImport接口（批量导入+模糊分类匹配+自动创建新分类+重复跳过）
- [x] 后端: getImportTemplate接口（生成包含当前项目分类名称的CSV模板）

### 前端
- [x] 前端: 批量导入卡片（点击+拖拽上传区域，支持CSV/TXT）
- [x] 前端: 解析预览表格（分类/标签名/标签值三列+行数统计）
- [x] 前端: 列映射检测结果显示（自动检测+显示匹配结果）
- [x] 前端: 导入结果统计（新增/跳过(重复)/新建分类四格卡片）
- [x] 前端: 下载导入模板按钮（包含项目分类名称的CSV）

### 测试
- [x] Tests: CSV解析测试（6个：引号/逗号/空行/Windows换行/两列）
- [x] Tests: 列检测测试（7个：中文/英文/混合/fallback/单列/乱序）
- [x] Tests: 集成测试（3个：完整流程+BOM+路由注册）
- [x] 全部769个测试通过

## 标签CSV导出功能 (2026-03-16)

### 后端
- [x] 后端: exportTagsCsv接口（将项目标签数据导出为CSV，含BOM+5列：分类名称/标签名称/标签值/来源/确认状态）

### 前端
- [x] 前端: 导出CSV按钮（标签管理头部，FileDown图标）
- [x] 前端: CSV文件下载逻辑（Blob+download触发+成功提示）

### 测试
- [x] Tests: 13个CSV导出测试通过（转义/格式/路由集成）
- [x] 全部782个测试通过

## 标签与交叉分析联动 (2026-03-16)

### 后端
- [x] 后端: getConfirmedProjectTags接口（读取项目已确认标签，按分类分组+状态统计）
- [x] 后端: runTagCrossAnalysis接口（基于项目标签维度生成交叉矩阵+AI洞察，支持自动/手动选择维度）
- [x] 后端: AI交叉分析提示词（标签体系交叉矩阵+蓝海机会+市场洞察）

### 前端
- [x] 前端: 属性交叉分析阶段左侧面板增加项目标签状态显示
- [x] 前端: 自动读取已确认标签数据，显示确认进度（N/M）
- [x] 前端: 维度选择器（维度1/维度2下拉菜单，显示分类名+标签数）
- [x] 前端: 标签全部确认时自动切换为标签交叉分析，否则使用产品级标签
- [x] 前端: 标签未确认/未初始化时显示提示引导用户先完成标签管理

### 测试
- [x] Tests: 14个交叉分析测试通过（路由注册/Schema/计算逻辑/数据格式/集成流程）
- [x] 全部796个测试通过

## 销量表格上传修复 + 评论批量上传 (2026-03-16)

### Bug修复
- [x] 分析用户上传的销量表格文件结构（卖家精灵导出格式，列名含$后缀等）
- [x] 修复销量表格上传解析错误（pick/pickNum多列名匹配：商品标题/价格($)/评分数/小类BSR/Buybox卖家/卖家所属地/大类目/小类目/商品主图等13个字段）

### 新功能
- [x] 评论文件批量上传（支持多文件拖拽/选择，自动从文件名提取ASIN，进度显示）

### 测试
- [x] Tests: 14个销量表格列名映射测试（卖家精灵格式+旧格式+完整行解析）
- [x] Tests: 6个评论批量上传测试（ASIN提取+评论解析+空内容过滤+多文件标志）
- [x] 全部816个测试通过

## 首页设计 + 全局导航优化 (2026-03-16)

### 首页
- [x] 将用户提供的首页设计设置为默认首页（5大工具模块卡片+统计数据+全链路工作流）
- [x] 工具总名称更新为“亚马逊全链路智能工具”

### 导航
- [x] 侧边栏顶部添加“首页”按钮，一键返回首页
- [x] 全局导航中添加首页入口（桌面端+移动端）

### 测试
- [x] Tests: 18个首页渲染测试（模块卡片/状态标签/工作流/统计数据/导航按钮）
- [x] 全部834个测试通过

## 市场分析框架审查与优化建议 (2026-03-16)

- [x] 审查7阶段分析框架全部代码（Schema/统计引擎/AI提示词/前端展示）
- [x] 审查数据上传解析逻辑和字段映射
- [x] 输出现有框架文档和优化建议报告

## 市场分析7阶段框架全面优化 (2026-03-16)

### P0 紧急修复
- [x] 统计引擎补充: medianMonthlySales, medianMonthlyRevenue, brandCount, top10SalesShare, avgMonthlySalesPerAsin
- [x] 修复市场大盘AI字段映射: summary→marketSummary等全部字段对齐
- [x] 市场大盘前端重构: 新增市场成熟度/增长趋势/季节性/市场容量/进入时机结构化卡片
- [x] 修复KANO分类不一致: 统一AI输出和前端渲染分类体系(painPoints/itchPoints/wowPoints)
- [x] 修复opportunities展示: JSON原文改为列表渲染

### P1 核心增强
- [x] 市场大盘新增月度趋势折线图(双Y轴)
- [x] 市场大盘新增价格-销量散点图
- [x] 市场大盘新增新品vs老品对比
- [x] 属性交叉新增热力图可视化
- [x] 品牌竞争新增品牌月度趋势图
- [x] 品牌竞争新增中国卖家份额展示
- [x] 评论深度新增评分分布图和评论趋势图
- [x] 全阶段AI分析结果改为结构化卡片展示

### P2 体验优化
- [x] 编辑模式从JSON编辑器改为表单式编辑
- [x] 增加数据质量评估提示
- [x] 增加阶段间数据传递(分析进度条+确认状态)
- [x] 综合决策阶段自动汇总前序已确认结果(含确认/未确认状态提示)

## 数据确认保存 + 阶段解锁重分析 (2026-03-16)

### 数据上传确认保存
- [x] 数据库: devUploadedFiles表增加confirmed和confirmedAt字段
- [x] 后端: 新增confirmData/unconfirmData/getDataStatus接口
- [x] 前端: 数据上传页增加"确认保存"按钮和确认状态展示
- [x] 前端: 四种文件类型各自独立确认，显示确认进度条
- [x] 前端: 已确认数据显示永久保存标识，可在项目内任意调用

### 分析阶段解锁重分析
- [x] 后端: 新增unlockStage接口，将已确认阶段重置为generated状态
- [x] 前端: 已锁定阶段显示"解锁重新分析"按钮
- [x] 前端: 解锁时增加二次确认对话框（说明解锁后需重新确认才能用于综合决策）
- [x] 前端: 显示确认锁定时间戳
- [x] 全部903个测试通过

## 阶段门控机制 (2026-03-16)

### 门控规则
- [x] 定义阶段依赖关系: 属性标注→市场大盘→属性交叉→价格分析→品牌竞争→评论深度→综合决策

### 门控规则
- [x] 数据确认门控: 销量数据必须确认后才能开始属性标注分析
- [x] 评论数据门控: 评论数据必须确认后才能开始评论深度分析
- [x] 阶段依赖门控: 每个阶段需前置阶段确认锁定后才能运行

### 后端校验
- [x] 后端: 每个runStage接口增加前置条件校验(checkStageGating)
- [x] 后端: 新增getStageGating接口返回各阶段可用状态

### 前端展示
- [x] 前端: 不满足前置条件的阶段禁用运行按钮+显示"未解锁"
- [x] 前端: 显示门控提示信息（缺少哪些前置条件+待完成步骤列表）
- [x] 前端: 阶段导航栏显示可用/锁定/已完成状态图标
- [x] 前端: 右侧内容区域显示友好的门控面板（替代空白）
- [x] 全部938个测试通过
## Bug修复 (2026-03-16)
- [x] 修复: 数据确认保存后记录条数显示为0 (原因: uploadFile未保存totalRows，新增updateFileRows接口在解析完成后更新)

## 重复文件名去重 (2026-03-16)
- [x] 后端: 上传文件时检查同项目同文件类型下是否存在同名文件，存在则删除旧记录(deleteOldFilesByName)
- [x] 后端: products通过ASIN upsert自动去重，无需额外处理
- [x] 前端: 重复上传时toast提示"已自动替换同名旧文件"
- [x] 全部948个测试通过

## AI基于标题五点数据生成标签 (2026-03-16)
- [x] 后端: 增强aiGenerateTags接口，优先读取已确认的标题五点数据(bulletPoints截取2000字符)
- [x] 后端: 增强aiGenerateCategoryTags接口，同样使用丰富上下文(30个产品)
- [x] 后端: AI提示词优化，深度分析品类词/材质词/功能词/场景词/规格参数/核心卖点/技术参数
- [x] 前端: 标签管理区域显示数据来源提示(标题五点数据确认状态+记录数)
- [x] 前端: 未确认时显示警告建议先上传确认标题五点数据
- [x] 全部965个测试通过

## AI标签生成准确性修复 (2026-03-16)
- [x] 审查: 当前AI提示词存在允许AI编造内容的漏洞（缺少禁止编造约束）
- [x] 审查: 数据提取层bulletPoints截取2000字符，可能丢失独特卖点
- [x] 修复: 重写AI提示词，增加“绝对禁止编造”“每个标签必须有原文依据”“宁缺毻滥”三大硬约束
- [x] 修复: 通用标签分层提取（第一层：多产品共有属性）
- [x] 修复: 差异化标签分层提取（第二层：逐个产品检查独特功能/专利技术/特殊设计，不能遗漏）
- [x] 修复: AI输出增加evidence字段，每个标签标注“产品#N 标题/五点: 原文片段”
- [x] 优化: bulletPoints不再截断，完整传递原文；产品数据量从30提升到50
- [x] 数据库: 新增sourceEvidence字段存储原文依据
- [x] 前端: AI标签显示原文依据（蓝色背景提示框）
- [x] CSV导出: 增加“原文依据”列
- [x] 测试: 新增tagAccuracy.test.ts验证反幻觉提示词、evidence字段、数据完整性
- [x] 全部988个测试通过

## Bug修复: AI标签生成数量为0 (2026-03-16)
- [x] 排查: 测试文件列名为「产品卖点」，但parseBulletPointsData只识别「五点描述」等列名
- [x] 排查: 数据库确认所有产品bulletPoints均为null，title为空字符串
- [x] 修复: parseBulletPointsData增加「产品卖点」「卖点」「产品五点」等列名映射
- [x] 修复: parseBulletPointsData增加「详细参数」「商品标题」等列名映射
- [x] 修复: upsertDevProducts改为只更新非空字段，避免不同文件上传时互相覆盖数据
- [x] 修复: AI标签生成前增加数据质量检查，数据为空时给出明确错误提示
- [x] 验证: 全部996个测试通过

## AI标签中文翻译与同义合并 (2026-03-16)
- [x] 后端: aiGenerateTags提示词要求tagName/tagValue输出中文，包含翻译示例
- [x] 后端: aiGenerateTags提示词要求合并中文含义相同的标签，包含合并示例和判断标准
- [x] 后端: aiGenerateCategoryTags提示词同样要求中文输出和同义合并
- [x] 后端: JSON schema描述更新为中文输出和英文原文依据
- [x] 后端: evidence字段保留英文原文供追溯
- [x] 测试: 新增12个测试验证中文输出、同义合并、evidence英文保留
- [x] 全部1008个测试通过

## 竞品全景分析表 (2026-03-16)
- [x] 数据库: devProducts表扩展新墝字段(父ASIN/SKU/FBA费用/毛利率/LQS/留评率/A+/视频/品牌故事等)
- [x] 数据库: 新建dev_panorama_status表存储确认状态
- [x] 后端: devPanorama路由器(getData/getStatus/confirm/unlock/updateProductField/updateProductTag/exportCsv)
- [x] 后端: getData合并三表数据+动态历史列+动态标签列
- [x] 后端: 单元格编辑、标签编辑、确认锁定、解锁、CSV导出
- [x] 前端: PanoramaTable组件(分页表格、搜索、列组显隐、内联编辑、排序)
- [x] 前端: 分组表头(11大分组+历史月销量+属性标签)
- [x] 前端: 确认/解锁按钮和状态显示
- [x] 前端: 下载CSV按钮
- [x] 前端: 全景分析表tab插入标签管理和分析报告之间
- [x] 逻辑: 市场大盘/属性交叉/价格段/品牌竞争分析前置检查全景表确认状态
- [x] 测试: 全部1066个测试通过

## Bug修复: 销量表格上传失败-字段类型不匹配 (2026-03-16)
- [x] 修复: 前端parseSalesData中bsrGrowthRate/grossMargin/monthlySalesGrowth/reviewRate/fbaFee用String()包装确保传字符串
- [x] 修复: FBA($)列名映射优先级调整，新增“月新增\n评分数”列名支持(包含换行符)
- [x] 修复: hasAPlus/hasVideo/hasBrandStory/hasAmazonChoice支持Y/是/1多种值格式
- [x] 验证: 全部1066个测试通过，0个TS错误

## 全景表标签编辑+销量趋势图 (2026-03-16)
- [x] 前端: TagDropdownEditor组件 - 下拉选择已有标签值+自由输入组合，支持输入过滤
- [x] 前端: 编辑后调用updateProductTag API保存，标签显示为Badge样式
- [x] 前端: 锁定后点击标签提示“请先解锁”，与确认状态联动
- [x] 前端: SalesTrendDialog组件 - Recharts折线图，支持多达15个ASIN对比
- [x] 前端: ASIN列增加趋势图按钮，点击弹出销量趋势对比图
- [x] 前端: 摘要统计表（最高/最低/平均月销、数据月数）
- [x] 前端: 头部“销量趋势”快捷按钮，默认选中前5个ASIN
- [x] 测试: 全部1066个测试通过，0个TS错误

## 全景表属性标签筛选器 (2026-03-16)
- [x] 前端: 顶部增加「标签筛选」按钮，可折叠展开筛选面板
- [x] 前端: 按标签类别分组显示，每行一个类别，选中时高亮边框
- [x] 前端: 每个类别下显示所有标签值为rounded pill多选按钮
- [x] 前端: AND/OR筛选逻辑（类别间AND，类别内OR）
- [x] 前端: 筛选结果实时更新表格和分页
- [x] 前端: 显示匹配数量（筛选面板内+分页栏）
- [x] 前端: 一键清除全部筛选+单类别清除+单标签点击移除
- [x] 前端: 收起时显示活动筛选条件摘要栏(Badge形式)
- [x] 测试: 全部1066个测试通过，0个TS错误
