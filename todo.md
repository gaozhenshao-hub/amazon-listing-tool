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
