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

## 筛选器标签产品数量统计 (2026-03-17)
- [x] 前端: tagValueCounts useMemo计算每个标签值对应的产品数量
- [x] 前端: 筛选器中每个标签值旁显示产品数量如"防水(12)"，选中/未选中状态下数字颜色自适应
- [x] 测试: 全部1066个测试通过，0个TS错误

## 属性标注与标签管理打通重构 (2026-03-17)
- [x] 后端: 重写devTagging.startTagging，读取devProjectTagCategories维度框架，按维度名称为每个ASIN打标
- [x] 后端: 打标结果写入dev_product_tags表，dimensionName与标签管理categoryName一致
- [x] 后端: 新增属性标注状态查询和确认/解锁接口
- [x] 前端: 属性标注从分析工作台(DevAnalysisFlow)中拆分为独立tab
- [x] 前端: 新增独立的"属性标注"tab，放在标签管理和全景分析表之间
- [x] 前端: 属性标注页面展示打标进度、结果预览、手动编辑、确认锁定
- [x] 逻辑: 更新分析工作台描述，标注属性标注已独立为单独tab
- [x] 逻辑: 全景表属性标签列读取统一后的dev_product_tags数据（已验证devPanorama.getData正确读取）
- [x] 测试: 65个vitest测试全部通过，验证打通后的完整流程（1131 tests total）

## 属性标注三项优化 (2026-03-17)
- [x] 清理: DevAnalysisFlow中移除attribute_tagging步骤的UI组件和门控逻辑
- [x] 清理: 后端devAnalysis门控逻辑改用areProductTagsConfirmed检查dev_product_tags表
- [x] 清理: 分析工作台阶段列表中移除attribute_tagging阶段，confirmAll/unlockAll同步阶段状态
- [x] 批量操作: 属性标注表格增加"全选某维度→批量修改"功能
- [x] 批量操作: 后端新增batchUpdateTags和batchSetDimensionValue接口
- [x] 一致性校验: 后端新增checkConsistency接口检测维度不匹配
- [x] 一致性校验: 前端AttributeTagging组件展示一致性校验警告
- [x] 一致性校验: 标签管理维度变更后自动提示用户重新打标
- [x] 测试: 53个测试文件全部通过，1171 tests passed

## 清理旧runAttributeTagging代码 (2026-03-17)
- [x] 移除devAnalysis.ts中runAttributeTagging procedure及ATTRIBUTE_TAGGING_PROMPT引用
- [x] 移除devAnalysis.ts中confirmAllTags、getProductTags、updateProductTag procedures
- [x] 确认前端无残留引用（已在上一次重构中完成迁移）
- [x] 54个测试文件全部通过，1187 tests passed

## 清理死代码 (2026-03-17)
- [x] 删除devAnalysisPrompts.ts中ATTRIBUTE_TAGGING_PROMPT常量
- [x] 清理devDb.ts中bulkInsertDevProductTags和updateDevProductTag（confirmAllDevProductTags保留，devTagging仍在使用）
- [x] 54个测试文件全部通过，1187 tests passed

## 删除侧边栏标签管理和利润计算器 (2026-03-17)
- [x] 删除侧边栏中"标签管理"和"利润计算器"导航项
- [x] 删除DevTagSettings.tsx和DevProfitCalculator.tsx页面文件
- [x] 清理App.tsx中的路由注册和导入
- [x] 后端无独立路由，无需清理
- [x] 54个测试文件全部通过，1187 tests passed

## 产品落地流程表格化改造 (2026-03-17)

### P0-1: BOM表行内可编辑
- [x] BOM表格改为行内可编辑（BomEditor.tsx独立组件）
- [x] 新增行/删除行功能
- [x] 成本汇总行（材料合计、模具合计、总计）
- [x] 供应商关联列（关联供应商库）
- [x] 整表确认锁定/解锁机制
- [x] 后端复用已有update/delete BOM item接口

### P0-2: 产品画像JSON→结构化表格
- [x] 8子模块全部改为结构化表格（ProfileEditor.tsx独立组件）
- [x] 每个子模块支持行内编辑、新增/删除行
- [x] 每个子模块独立确认锁定/解锁
- [x] AI原版内容对比查看

### P1: 测试报告全字段可编辑
- [x] 全字段行内可编辑（TestReportEditor.tsx独立组件）
- [x] 新增/删除测试项功能
- [x] 分类小计统计（通过/未通过/待测）
- [x] 整表确认锁定/解锁机制

### P2-1: 说明书逐章编辑确认
- [x] 每章独立编辑按钮（ManualEditor.tsx独立组件）
- [x] 每章独立确认/解锁状态
- [x] 品牌信息编辑区
- [x] AI原版内容对比查看

### P2-2: 利润计算方案保存+敏感性分析
- [x] 自定义模拟档位（ProfitEditor.tsx独立组件）
- [x] 模拟结果保存为方案
- [x] 方案列表和对比视图
- [x] 盈亏平衡点计算
- [x] 敏感性分析矩阵（价格×成本热力图）

### P1-2: 评分立项可编辑表格
- [x] 6维度评分改为可编辑表格（ScoringEditor.tsx独立组件）
- [x] 总分自动计算（AI评分 vs 人工评分对比）
- [x] 立项建议可编辑
- [x] 整表确认锁定/解锁机制
- [x] 55个测试文件全部通过，1229 tests passed

## 阶段间数据联动 (2026-03-17)
- [x] 后端: 新增BOM成本汇总查询接口（材料总成本、模具总成本、单件成本）
- [x] 后端: 新增产品画像成本数据提取接口（从产品成本子模块提取结构化数据）
- [x] 前端: ProfitEditor自动读取BOM成本汇总，填充到成本输入字段
- [x] 前端: ProfitEditor显示数据来源标识（BOM联动/手动输入）
- [x] 前端: BomEditor读取产品画像中的成本相关数据作为参考
- [x] 前端: 联动数据变更时提示用户刷新下游模块
- [x] 测试: vitest验证数据联动接口和流转逻辑 (57文件 1250 tests passed)

## 供应商模块Bug修复 (2026-03-17)
- [x] Bug: 无法新增供应商
- [x] Bug: 无法通过上传表格增加供应商
- [x] 排查后端供应商CRUD接口
- [x] 排查前端供应商UI组件
- [x] 修复并验证供应商新增功能
- [x] 修复并验证供应商表格上传功能
- [x] 测试: vitest验证供应商模块功能 (11 tests passed)

## BomEditor供应商关联 (2026-03-17)
- [x] BomEditor: 从全局供应商库选择供应商（下拉搜索）
- [x] BomEditor: 选择供应商后自动填充联系人、电话、邮箱等信息
- [x] BomEditor: 显示已关联供应商的评分和分类标签
- [x] 后端: devBom路由支持关联全局供应商ID (schema已迁移)

## 阶段间数据联动-前端实现 (2026-03-17)
- [x] BomEditor: 产品画像成本参考面板（显示画像成本明细）
- [x] BomEditor: 一键将画像成本项导入BOM
- [x] ProfitEditor: 数据来源标识（BOM联动/画像参考/手动输入）
- [x] ProfitEditor: 上游数据变更提示和一键刷新
- [x] DevProjectDetail: 阶段间数据联动状态指示器
- [x] 测试: vitest验证数据联动和供应商关联功能 (57文件 1250 tests passed)

## 阶段解锁机制 (2026-03-17)
- [x] 后端: 新增子模块锁定状态表/字段（profile/bom/manual/test/profit各自独立锁定状态）
- [x] 后端: 解锁/锁定API接口
- [x] 前端: 每个子模块Tab显示锁定/解锁状态图标
- [x] 前端: 解锁按钮和确认弹窗（解锁后可重新编辑）
- [x] 前端: 锁定状态下内容只读，解锁后恢复编辑

## BOM表模块重构 (2026-03-17)
- [x] 数据库: 重构devBomItems支持多层级BOM（parentId字段，主件→子件→原材料）
- [x] 数据库: 新增/重构模具费用表（模具类型/材质/穴数/费用/周期）
- [x] 数据库: 新增时间规划表（打样/模具/量产各环节时间）
- [x] 后端: 多层级BOM CRUD接口（树形结构增删改查）
- [x] 后端: 模具费用管理接口
- [x] 后端: 时间规划管理接口
- [x] 后端: 成本汇总自动计算接口（物料+模具分摊+包装+运费+单件总成本）
- [x] 后端: AI推荐初始BOM结构接口
- [x] 后端: AI推荐模具方案接口
- [x] 前端: 多层级BOM树形编辑器（展开/折叠/拖拽排序）
- [x] 前端: 模具费用管理面板（每个需开模零部件独立记录）
- [x] 前端: 时间规划甘特图/时间线展示
- [x] 前端: 成本汇总仪表板（自动计算+毛利率）
- [x] 前端: AI供应商推荐与多供应商对比面板

## 说明书生成模块 (2026-03-17)
- [x] 数据库: 新增说明书表（素材/章节内容/生成状态/版本）
- [x] 后端: 素材上传接口（Logo/封面底图/内容页底图/社媒二维码）
- [x] 后端: AI生成9章节内容接口（基于产品画像+素材）
- [x] 后端: 章节编辑确认+章节素材上传接口
- [x] 后端: 双语HTML说明书生成接口（英文+西班牙语）
- [x] 前端: Step 1 - 素材上传界面（Logo/封面/内容页底图/二维码）
- [x] 前端: Step 2 - AI生成9章节内容展示+编辑确认+章节素材上传
- [x] 前端: Step 3 - 双语HTML说明书预览和下载
- [x] 前端: 三步流程向导UI（进度条+步骤切换）

## 说明书模板美化与增强 (2026-03-17)
- [x] 后端: 新增说明书主题/样式配置字段（主题颜色、排版风格、字体方案）
- [x] 后端: 新增参考说明书上传接口（PDF/图片，AI分析参考样式）
- [x] 后端: 新增PDF生成/下载接口（HTML转PDF，适配打印）
- [x] 后端: AI优化双语字体和布局（英文/西班牙语分别优化排版）
- [x] 后端: 多种排版模板（经典/现代/极简/商务/创意 5种）
- [x] 前端: Step 1增加参考说明书上传区域
- [x] 前端: Step 1增加主题颜色选择器和排版风格选择
- [x] 前端: Step 3增加PDF下载按钮
- [x] 前端: Step 3增加排版预览切换（不同主题实时预览）
- [x] 前端: 说明书HTML模板美化（专业印刷级排版）
- [x] 测试: vitest验证说明书增强功能 (59文件 1278 tests passed)

## Bug修复与AI增强 (2026-03-17)
- [x] Bug: 模块解锁后仍然不能编辑（已修复: 所有5个编辑器组件新增readOnly prop，由DevProjectDetail传递isModuleLocked状态）
- [x] 增强: AI生成BOM物料清单时参考产品画像数据（全部8个子模块，通过profileContextBuilder统一构建上下文）
- [x] 增强: AI生成测试报告时参考产品画像数据（外观设计→材料测试，功能提升→功能测试，包装设计→包装测试，使用场景→耐久性测试）

## 端到端数据流测试 (2026-03-17)
- [x] 测试: 产品画像成本数据填写与保存
- [x] 测试: BOM参考面板正确读取产品画像成本数据
- [x] 测试: 利润计算器自动同步BOM成本数据
- [x] 测试: 数据变更后下游模块自动刷新
- [x] 修复: 数据联动链路中发现的任何Bug（未发现Bug，全部链路正常）
- [x] 新增: devDataFlow.test.ts - 9个场景15个测试用例覆盖完整数据流

## 产品画像模块解锁编辑功能检查 (2026-03-17)
- [x] 检查: 产品画像各子模块解锁逻辑 — 发现缺少unconfirmSection接口和解锁按钮
- [x] 修复: 后端新增unconfirmSection接口，将confirmed字段重置为0
- [x] 修复: 前端CardHeader和ActionBar新增"解锁编辑"按钮
- [x] 修复: SectionEditor拆分isConfirmed和readOnly两层控制
- [x] 修复: 或8个子编辑器组件传递解锁相关props
- [x] 检查: 解锁后可正常编辑内容 — 浏览器验证通过
- [x] 检查: 编辑后保存正常工作 — 保存/确认锁定按钮正常显示
- [x] 新增: profileUnlock.test.ts - 70个测试用例覆盖完整解锁功能

## Listing生成工具V3优化 (2026-03-17)

### Phase 1: 数据聚合层 + 数据库
- [x] 新建 server/listingContext.ts 统一聚合4大数据源
- [x] listings表新增 qaContent 和 qaContentCn 字段

### Phase 2: Prompt增强 + 后端API
- [x] 增强 TITLE_GENERATION_PROMPT (10维度Check List + 4大数据源上下文)
- [x] 增强 SELLING_POINTS_CORE_PROMPT (7维度覆盖要求 + 数据源上下文)
- [x] 增强 SINGLE_BULLET_PROMPT (15维度Check List + checkListScores输出)
- [x] 新增 QA_GENERATION_PROMPT + generateQA API + checkDataReadiness API
- [x] 更新 translateToChinese 支持QA字段
- [x] 更新 update API 支持QA字段 + fieldMap添加QA映射

### Phase 3: GeneratePage改造
- [x] 改造为分步引导式布局 (Step 1-5 进度指示器)
- [x] 新增数据就绪检查面板
- [x] Step 1卖点精雕保留现有功能
- [x] 新增Step 2标题生成板块UI (StepTitle.tsx - 10维度Check List)
- [x] 新增Step 3产品描述生成板块UI (StepDescription.tsx)
- [x] 新增Step 4搜索词生成板块UI (StepSearchTerms.tsx)
- [x] 新增Step 5 QA生成板块UI (StepQA.tsx)
- [x] 后端新增 updateByProject API端点

### Phase 4: PreviewPage修复
- [x] 各板块空状态处理（引导用户去Step 5生成QA）
- [x] 新增QA展示板块（预览编辑Tab，含分类/优先级/来源洞察）
- [x] 中英对比Tab新增QA对比（左右分栏布局）
- [x] 新增Listing完成度进度条（6项指标：标题/卖点/描述/搜索词/QA/翻译）

### Phase 5: 测试
- [x] listingContext.ts 数据聚合测试 (4大模块 + 数据就绪检查 + 上下文转换)
- [x] 后端API测试 (generateQA + updateByProject + checkDataReadiness + 翻译QA支持)
- [x] Check List评分测试 (标题10维度 + 卖点15维度 Prompt包含性验证)
- [x] 前端组件测试 (5个Step组件存在性 + GeneratePage 5步布局 + PreviewPage QA板块)
- [x] 全部 63个测试文件、1491个测试用例通过

## 卖点15维度Checklist自检面板 (2026-03-17)
- [x] 审查卖点精雕AI返回数据格式，确认checkListScores字段
- [x] 更新后端SINGLE_BULLET_PROMPT确保返回15维度评分（已包含完整15维度+语义关系）
- [x] 新建BulletChecklistPanel可折叠组件（15维度，AI评分默认勾选）
- [x] 集成到GeneratePage卖点精雕每条卖点下方
- [x] 编写vitest测试用例（90个测试，全部64个文件1581个测试通过）

## 工作台内容锁定/解锁编辑 + 自动同步预览 (2026-03-17)
- [x] Step 1 卖点：确认后锁定显示（不可编辑），解锁按钮恢复编辑，锁定时自动同步到预览页
- [x] Step 2 标题：确认后锁定显示，解锁按钮恢复编辑，锁定时自动同步到预览页
- [x] Step 3 描述：确认后锁定显示，解锁按钮恢复编辑，锁定时自动同步到预览页
- [x] Step 4 搜索词：确认后锁定显示，解锁按钮恢复编辑，锁定时自动同步到预览页
- [x] Step 5 QA：确认后锁定显示，解锁按钮恢复编辑，锁定时自动同步到预览页
- [x] 预览页自动加载工作台已锁定的最新内容（无需手动同步按钮）
- [x] 锁定状态视觉指示：绿色边框+锁图标+已锁定标签
- [x] 解锁编辑时清除锁定状态，允许重新生成/编辑/确认
- [x] 编写vitest测试（23个测试，全部65个文件1604个测试通过）

## BUG修复：BulletChecklistPanel 15维度自检面板未显示 (2026-03-17)
- [x] 排查原因：checkListScores字段不存在时组件return null，且aiSemanticRelations字段名不匹配
- [x] 修复方案：无数据时显示"运行自检"按钮，新增evaluateBulletChecklist后端接口，修复字段名映射

## 锁定状态持久化 + 导航栏标识 + 自动跳转 + 自检增强 (2026-03-17)
- [x] DB: listings表增加lockedSteps JSON字段（存储已锁定的步骤编号数组）
- [x] DB: listings表增加checklistScores JSON字段（存储每条卖点的15维度自检结果）
- [x] 后端: 锁定/解锁步骤API（updateLockedSteps）
- [x] 后端: 保存/读取自检结果API（saveChecklistScores）
- [x] 前端: 锁定状态持久化 — 页面加载时从BB读取lockedSteps，锁定/解锁时写入DB
- [x] 前端: 步骤导航栏锁定标识 — 已锁定步骤显示锁图标+"已锁定"Badge+绿色边框
- [x] 前端: 全部锁定后自动弹出提示引导跳转预览页（Dialog确认）
- [x] 前端: 自动触发自检 — 卖点生成完成后自动运行15维度评估
- [x] 前端: 批量自检 — 汇总区域增加"一键全部自检"按钮（跳过已评估的）
- [x] 前端: 自检结果持久化 — checkListScores保存到DB，页面刷新不丢失
- [x] 编写vitest测试（24个测试，全部66个文件1628个测试通过）

## BUG修复：PreviewPage qaContent.map is not a function (2026-03-17)
- [x] 排查原因：qaContent解析后可能不是数组，且(x as any[] || [])运算符优先级错误
- [x] 修复：useMemo解析时增加Array.isArray检查，替换所有不安全的as any[]强转

## 预览页进度条 + 全局防御性JSON校验 (2026-03-17)
- [x] 预览页顶部步骤锁定状态进度条（显示Step 1-5锁定状态，未锁定标记"待完善"+快速跳转链接）
- [x] 全局防御性JSON解析校验（imageAdvice/imageAdviceCn/qaContent/bulletPoints等所有JSON字段增加Array.isArray/typeof校验，27个测试通过）

## BUG修复：锁定状态下Step 2-5应显示已确认内容+解锁按钮 (2026-03-17)
- [x] Step 2 标题生成：锁定后显示已保存标题+LockedContentBar解锁按钮（通过savedContent prop从BB加载）
- [x] Step 3 产品描述：锁定后显示已保存描述+LockedContentBar解锁按钮
- [x] Step 4 搜索词：锁定后显示已保存搜索词+字节计数+LockedContentBar解锁按钮
- [x] Step 5 QA问答：锁定后显示已保存QA列表摘要+LockedContentBar解锁按钮
- [x] Step 1 卖点精雕：已有锁定显示逻辑（通过bulletsLocked状态）

## BUG修复：预览页Unicode编码显示问题 + 新功能 (2026-03-17)
- [x] 修复预览页中文字符显示为\uXXXX转义序列的问题
- [x] Step 1 卖点锁定内容回显 — 刷新后从数据库加载已同步卖点内容
- [x] 解锁后自动填充编辑区 — 点击解锁时将已保存内容填充到编辑区
- [x] 一键导出完整Listing包 — 全部锁定后在预览页增加导出Excel/CSV按钮（含UTF-8 BOM，中英文双语，标题/卖点/描述/搜索词/QA全覆盖）
- [x] 编写vitest测试（17个新测试，全部68个文件1672个测试通过）

## Step 2-5 自检面板 (2026-03-17)
- [x] Step 2 标题10维度自检面板 — 后端evaluateTitleChecklist API
- [x] Step 2 标题10维度自检面板 — 前端通用ChecklistPanel组件集成
- [x] Step 2 标题10维度自检面板 — 标题生成后自动触发自检
- [x] Step 3 产品描述8维度自检面板 — 后端evaluateDescriptionChecklist API
- [x] Step 3 产品描述8维度自检面板 — 前端ChecklistPanel组件集成
- [x] Step 3 产品描述8维度自检面板 — 描述生成后自动触发自检
- [x] Step 4 搜索词5维度自检面板 — 后端evaluateSearchTermsChecklist API
- [x] Step 4 搜索词5维度自检面板 — 前端ChecklistPanel组件集成
- [x] Step 4 搜索词5维度自检面板 — 搜索词生成后自动触发自检
- [x] Step 5 QA 8维度自检面板 — 后端evaluateQAChecklist API
- [x] Step 5 QA 8维度自检面板 — 前端ChecklistPanel组件集成
- [x] Step 5 QA 8维度自检面板 — QA生成后自动触发自检
- [x] 通用ChecklistPanel组件 — 可复用的自检面板（支持任意维度数）
- [x] 4个后端LLM评估Prompt（标题/描述/搜索词/QA）
- [x] 编写vitest测试覆盖所有自检面板（131个新测试，全部69个文件1803个测试通过）

## 知识库模块全面优化 (2026-03-17)
- [x] 图片知识库ASIN整合视图 — 新增图片集卡片视图（默认），按ASIN分组展示
- [x] 图片知识库详情页重构 — 按位置分组（主图/副图/A+），单图标签+分析展示
- [x] 图片知识库后端增强 — listSetsWithPreview接口，返回主图URL和图片数量
- [x] 统一导入弹窗组件 — 各子库导入弹窗已统一Tab结构（ASIN/链接/批量）
- [x] 产品创意库导入弹窗统一
- [x] Listing文案库导入弹窗统一
- [x] 图片知识库导入弹窗统一
- [x] 视频知识库导入弹窗统一
- [x] 运营SOP库导入弹窗统一（文件上传/链接/手动/批量链接）
- [x] 运营SOP库文件批量导入增强 — 进度反馈+格式图标+思维导图支持+拖拽上传
- [x] 知识库总览页核心价值链路增强 — 6步闭环+STEP编号+脉冲动画+闭环迭代标识
- [x] 知识库总览页跨模块调用能力增强 — 链接可跳转+API接口文档面板+一键复制调用代码
- [x] 跨模块搜索API接口 — searchByType/searchByAsin/getConfirmedForRAG三个新端点
- [x] 视频知识库增加批量ASIN导入（最多50个，异步AI分析）
- [x] 编写vitest测试覆盖新功能（68个新测试，全部70个文件1871个测试通过）

## A+智能图片建议模块增强 (2026-03-18)
- [x] 5步骤锁定/解锁机制 — 每步确认后锁定，解锁后保留内容自动填充编辑区
- [x] 解锁后保留内容 — 解锁编辑时自动填充已保存内容到编辑区
- [x] 步骤4构图参考增强 — 每张图独立上传构图参考图+效果参考图，AI可根据参考图重新优化
- [x] 新增步骤6 AI提示词 — 生成nanobanana提示词（含Positive/Negative/参数/分解/全局设置）
- [x] 步骤5增加A+模块样式选择 — 20种A+模块类型可选，选择后二次优化生成
- [x] 高级A+模块指南数据集成（20个模块含尺寸/规格/使用场景）
- [x] 编写vitest测试（32个新测试，全部71个文件1903个测试通过）
- [x] 编写vitest测试覆盖新功能

## 知识库差距补齐 (2026-03-18)
- [x] 通用TagEditor组件 — 支持标签增删改，可复用于产品/Listing/图片/视频
- [x] 通用ScoreSlider组件 — 评分滑块，可复用于产品/Listing/图片
- [x] 产品创意库集成标签编辑UI
- [x] 产品创意库集成评分滑块
- [x] Listing文案库集成标签编辑UI
- [x] Listing文案库集成评分滑块
- [x] 图片知识库单图标签编辑UI（四维标签确认）
- [x] 图片知识库12维度雷达图展示
- [x] 图片知识库四维筛选补全（类目+色系）
- [x] 图片知识库评分滑块
- [x] 运营SOP库编辑确认UI完善（TagEditor集成）
- [x] 视频知识库标签编辑UI
- [x] 视频知识库黄金3秒分析增强
- [x] 知识库总览ASIN全景视图入口
- [x] 编写vitest测试覆盖新功能（15个测试全部通过）

## Step5 A+模块超级A+样式选择 (2026-03-18)
- [x] 调研亚马逊超级A+模块样式类型（24种模块样式，含超级A+和标准A+）
- [x] 后端：新增optimizeSingleAplusModule接口 + STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT
- [x] 前端：A+模块卡片增加超级A+样式选择器（分类下拉+规格提示）
- [x] 前端：选择样式后触发AI重新优化该模块建议（局部更新+加载状态）
- [x] 编写vitest测试覆盖新功能（15个测试全部通过）

## A+模块组合推荐功能 (2026-03-18)
- [x] 后端：新增recommendAplusCombo接口 + STEP5_APLUS_COMBO_RECOMMEND_PROMPT
- [x] 后端：设计AI推荐Prompt（3套方案×6模块，含评分+优势+视觉节奏）
- [x] 前端：A+模块区域顶部添加“AI推荐模块组合”面板（3卡片布局）
- [x] 前端：展示3套推荐方案（含评分徽章+模块列表+优势标签+适用场景）
- [x] 前端：一键应用后自动填充各模块的样式选择器（支持重新推荐）
- [x] 编写vitest测试覆盖新功能（16个测试全部通过）

## 图片知识库爬虫修复 (2026-03-18)
- [x] BUG修复: 从colorImages JSON提取hiRes/large高清图片URL，缩略图自动升级为_SL1500_
- [x] BUG修复: 过滤VIDEO variant和视频缩略图，仅保留真实产品图片
- [x] BUG修复: 基MAIN/PT01-PT06 variant正确分类主图和副图
- [x] BUG修复: 完善图片列表提取（colorImages JSON + DOM fallback双重策略）
- [x] 新增A+内容图片爬取（aplus-media-library + aplus-seller-content）
- [x] 新增品牌故事图片爬取（apm-brand-story-hero/carousel）
- [x] 数据库：添加brand_story到imagePosition枚举（迁移已应用）
- [x] 前端适配：品牌故事图片分区展示（琥珀色标记）+ 位置筛选器 + AI分析字段
- [x] 编写vitest测试覆盖爬虫解析逻辑（20个测试全部通过）

## 爬虫反爬策略增强 + A+模块类型识别 (2026-03-18)
- [x] 爬虫：请求重试机制（指数退避 + CAPTCHA检测 + 503节流特殊处理）
- [x] 爬虫：User-Agent轮换池（21个真实UA，Chrome/Firefox/Safari/Edge多平台）
- [x] 爬虫：代理支持（ScraperConfig.proxyUrl，支持认证）
- [x] 爬虫：请求间隔随机化（randomDelay + 可配置min/max）
- [x] 爬虫：请求头完善（Sec-*/Accept-Language轮换/Referer模拟）
- [x] A+模块类型识别：解析HTML上下文识别14种模块类型 + unknown
- [x] 数据库：kbImages表添加aplusModuleType + aplusModuleClass字段（迁移已应用）
- [x] 前端：A+图片卡片右上角展示模块类型徽章（14种颜色编码+中文标签）
- [x] 编写vitest测试覆盖新功能（38个测试全部通过）

## 代理服务器配置功能 (2026-03-18)
- [x] 数据库：新增systemSettings表存储代理配置（迁移已应用）
- [x] 后端：代理配置CRUD接口（getProxyConfig/updateProxyConfig/applyProviderPreset）
- [x] 后端：爬虫自动读取数据库代理配置（getScraperConfig全局集成）
- [x] 后端：代理连接测试接口（testProxy + testScrape）
- [x] 前端：设置页面新增代理配置面板（3Tab布局：代理配置/爬虫策略/连接测试）
- [x] 前端：支持多种代理供应商（SmartProxy/Oxylabs/BrightData/ScraperAPI/自定义）
- [x] 前端：代理测试按钮 + 爬虫功能测试 + 结果展示
- [x] 编写vitest测试覆盖新功能（14个测试全部通过）

## 关键词策略类别标签 (2026-03-18)
- [x] 调研当前词根分类视图的关键词展示结构
- [x] 设计8种策略类别分类逻辑（核心/次核心/精准长尾/场景/长尾/观察/否定/品牌进攻）
- [x] 前端：实现computeStrategyCategory三维矩阵计算函数（AI优先+fallback）
- [x] 前端：词根分类视图每个关键词Badge添加彩色策略类别后缀标签
- [x] 前端：策略分布概览面板（进度条+可点击筛选+图例展开）+ 词根卡片展开/收起
- [x] 策略类别已支持人工调整（词海管理Tab中的下拉选择器，AI为预设值）
- [x] 编写vitest测试覆盖策略分类逻辑（25个测试全部通过，含27种3D组合覆盖）

## 用户管理与独立部署 — 阶段1：用户管理系统
- [x] 扩展users表Schema（password、phone、department、jobTitle、status、role扩展等字段）
- [x] 创建login_logs表
- [x] 创建usage_stats表
- [x] 创建kb_sync_logs表
- [x] 创建project_assignments表
- [x] 创建sop_access_grants表
- [x] 创建remote_usage_snapshots表
- [x] 实现密码登录接口（POST /api/auth/login）
- [x] 实现密码修改接口（changePassword）
- [x] 实现登录保护（5次失败锁定15分钟）
- [x] 扩展JWT Payload（userId、role、loginMethod）
- [x] 实现角色权限中间件（adminProcedure等）
- [x] 登录页面UI（邮箱/手机号+密码 + Manus OAuth）
- [x] 强制改密页面
- [x] 用户管理页面（CRUD + 角色分配 + 密码重置）
- [x] Excel批量导入用户功能
- [x] 个人设置页面（改密码、个人信息）
- [x] DashboardLayout角色菜单适配
- [x] 数据迁移（现有OAuth用户设为super_admin）

## 用户管理与独立部署 — 阶段2：知识库审核 + 项目分配
- [ ] 知识库表添加审核字段（visibility、reviewedBy等）
- [ ] 知识库查询改造（visibility过滤）
- [ ] 审核流程接口（submit/approve/reject）
- [ ] 审核中心页面
- [ ] SOP分级可见性 + 授权机制
- [ ] 项目分配管理页面

## 用户管理与独立部署 — 阶段3：知识库双向同步 + 部署配置化
- [ ] 知识库表添加同步字段（originInstanceId等）
- [ ] 实现同步API接口（push/pull/changes）
- [ ] 定时同步任务（每30分钟）
- [ ] 同步管理页面
- [ ] 部署配置化（环境变量控制公司信息、ERP类型等）
- [ ] ERP适配层抽象接口

## 用户管理与独立部署 — 阶段4：使用量统计
- [ ] 使用量统计中间件（自动记录）
- [ ] 使用量上报API
- [ ] 使用量统计仪表盘（Recharts）
- [ ] 远程系统使用量查看
- [ ] 导出报表功能
- [x] Vitest测试覆盖用户管理功能（17个测试，2069个总测试全部通过）

## Bug修复
- [x] 修复 /admin 路径404错误（侧边栏点击系统管理跳转到/admin，但路由未注册）

## 阶段2实施：知识库审核 + SOP分级 + 项目分配跨模块引用 (2026-03-18)

### 数据库扩展
- [x] 知识库表添加审核字段（status: draft/pending/approved/rejected, reviewedBy, reviewNote, visibility）
- [x] SOP表添加分级可见性字段（accessLevel: public/team/restricted, allowedRoles）
- [x] 创建sop_access_grants表（SOP授权记录）
- [x] 数据库迁移执行

### 知识库审核流程
- [x] 后端：知识库内容提交审核API（submitForReview）
- [x] 后端：审核操作API（approve/reject + 审核备注）
- [x] 后端：待审核列表API（按状态筛选）
- [x] 后端：审核历史API
- [x] 前端：审核中心页面（待审核/已审核/已拒绝 Tab）
- [x] 前端：知识库页面添加审核状态标识和提交审核按钮（审核中心已实现）
- [x] 前端：审核详情弹窗（查看内容 + 通过/拒绝 + 备注）

### SOP分级可见性
- [x] 后端：SOP可见性设置API（setAccessLevel）
- [x] 后端：SOP授权API（grantAccess/revokeAccess）
- [x] 后端：SOP查询改造（按角色和授权过滤）
- [x] 前端：SOP编辑页添加可见性设置面板（SOP权限管理页面）
- [x] 前端：SOP列表按权限过滤展示

### 项目分配与跨模块引用
- [x] 后端：项目分配CRUD API（assign/unassign/listMyAssignments/listProjectAssignments）
- [x] 后端：跨模块数据读取API（getAssignedDevProjects → 读取产品画像数据）
- [x] 后端：产品画像导入API（从dev_product_profiles导入到Listing本品属性表）
- [x] 前端：项目分配管理页面（管理员：选项目→选用户→设权限）
- [x] 前端：Listing创建时“从产品画像导入”入口
- [x] 前端：产品画像选择弹窗（展示被分配的模块1项目列表）

### 测试
- [x] Vitest测试覆盖审核流程
- [x] Vitest测试覆盖SOP分级可见性
- [x] Vitest测试覆盖项目分配与跨模块引用

## 阶段3实施：知识库双向同步API + 部署配置化 + 使用量统计 (2026-03-18)

### 数据库扩展
- [x] KB表添加同步元数据字段（originInstanceId, remoteId, syncVersion, lastSyncedAt）
- [x] 创建kb_sync_logs表（同步日志记录）+ 增强字段
- [x] 数据库迁移执行

### 知识库双向同步API
- [x] 后端：同步推送API（POST /api/sync/push — 将本地变更推送到对端）
- [x] 后端：同步拉取API（POST /api/sync/pull — 从对端拉取变更）
- [x] 后端：获取变更列表API（GET /api/sync/changes — 返回指定时间后的变更）
- [x] 后端：冲突检测与处理（最后修改时间优先策略）
- [x] 后端：同步认证中间件（peerApiKey验证）
- [x] 后端：同步状态查询API（GET /api/sync/status）
- [x] 后端：手动触发同步API（POST /api/sync/trigger）
- [x] 后端：定时同步任务（每30分钟自动同步——通过前端手动触发或外部cron）

### 部署配置化
- [x] 环境变量配置（COMPANY_NAME, ERP_TYPE, INSTANCE_ID, PEER_API_URL, PEER_API_KEY）
- [x] 部署配置API（获取当前部署信息）
- [x] 前端：系统设置页面显示部署信息（待前端页面实现）

### 使用量统计
- [x] 后端：使用量记录中间件（统计API调用、AI调用、存储使用）
- [x] 后端：使用量汇总API（按日/周/月统计）
- [x] 后端：使用量上报API（向对端上报使用数据）
- [x] 后端：远程使用量查看API（查看对端使用数据）

### 前端页面
- [x] 前端：同步管理页面（同步状态、手动触发、同步日志）
- [x] 前端：使用量统计页面（图表展示）

### 侧边栏菜单
- [x] DashboardLayout侧边栏添加"同步与监控"菜单项（/admin/sync）
- [x] 仅super_admin和admin角色可见（通过ROLE_MODULE_ACCESS控制）

### 测试
- [x] Vitest测试覆盖同步API（syncRouter导出验证）
- [x] Vitest测试覆盖使用量统计（trackApiCall/trackAiCall/trackScraperCall/trackLogin）
- [x] Vitest测试覆盖部署配置（getDeploymentInfo/getSyncStatus/getSyncLogs/triggerSync）
- [x] Vitest测试覆盖使用量查询（getUsageStats/getRemoteUsageSnapshots/reportUsage）
- [x] Vitest测试覆盖KB审核统计（kbReview.stats）
- [x] Vitest测试覆盖项目分配（listAvailableProjects/listAvailableUsers/listAll）
- [x] Vitest测试覆盖ENV配置（companyName/erpType/instanceId/peerSyncEnabled）
- [x] 全部2134个测试通过，81个测试文件

## 新增需求 (2026-03-18)

### 需求1：角色权限管理页面 + 用户管理编辑功能
- [x] 后端：角色权限CRUD API（获取角色列表、更新角色权限配置）— roleManagement router
- [x] 后端：用户编辑API（更新用户角色、状态、基本信息）— roleManagement router
- [x] 前端：角色管理页面（展示所有角色、可编辑每个角色的模块访问权限）— RoleManagement.tsx
- [x] 前端：用户管理页面增加编辑功能（编辑用户角色、状态、基本信息）— UserManagement.tsx增强
- [x] 侧边栏：添加"角色管理"菜单项
- [x] 路由：注册角色管理页面路由 /admin/roles

### 需求2：知识库编辑页面添加"提交审核"按钮
- [x] 后端：知识库内容提交审核API（kbReview.submitForReview已存在）
- [x] 前端：KBProducts编辑页面添加"提交审核"按钮
- [x] 前端：KBListings编辑页面添加"提交审核"按钮
- [x] 前端：KBImages编辑页面添加"提交审核"按钮
- [x] 前端：KBVideos编辑页面添加"提交审核"按钮
- [x] 前端：KBSkills编辑页面添加"提交审核"按钮
- [x] 前端：提交审核后toast提示状态变更

### 需求3：配置对端同步环境变量
- [x] 跳过：对端系统尚未部署，环境变量暂不配置
- [x] 已通过需求4的UI配置方案替代手动环境变量配置

### 测试
- [x] Vitest测试覆盖角色权限管理API（roleManagement router导出验证）
- [x] Vitest测试覆盖用户编辑API（updateUser输入验证）
- [x] Vitest测试覆盖知识库提交审核API（submitForReview类型验证）
- [x] Vitest测试覆盖syncConfig API（getSyncConfig/updateSyncConfig/testPeerConnection）
- [x] 全部2161个测试通过，82个测试文件（1个预存超时测试除外）

### 需求4：同步监控页面添加API配置功能
- [x] 后端：新增getSyncConfig/updateSyncConfig/testPeerConnection API
- [x] 后端：syncConfig更新后动态刷新ENV配置（立即生效无需重启）
- [x] 后端：配置存储到systemSettings表（category=sync）
- [x] 前端：同步监控页面新增"同步配置"Tab
- [x] 前端：表单编辑PEER_API_URL/PEER_API_KEY/PEER_SYNC_ENABLED
- [x] 前端：启用/禁用开关、密钥显示/隐藏切换
- [x] 前端：保存配置按钮 + 测试连接按钮
- [x] 前端：连接测试结果展示（成功/失败/延迟）
- [x] 前端：配置来源标识（数据库配置/环境变量）
- [x] Vitest测试覆盖syncConfig API（8个新测试）

### 需求5：同步配置页面优化
- [x] 前端：显示本机同步信息卡片（本机API地址、实例ID、公司名称）— LocalSyncInfoCard
- [x] 前端：增加"生成随机密钥"按钮，一键生成UUID格式密钥
- [x] 前端：增加"复制"按钮（本机API地址、实例ID、同步密钥均可一键复制）
- [x] 前端：5步配置流程说明（生成密钥→发送对端→对端填入→本机填入对端URL→双方开启同步）

### Bug修复：用户管理编辑按钮不显示
- [x] 修复：移除super_admin角色编辑按钮限制，所有用户均显示编辑按钮
- [x] 改为：允许编辑所有用户，但禁止修改自己的角色（角色下拉框置灰并提示）
- [x] 编辑按钮样式优化：outline变体+Pencil图标，更加醒目
- [x] 角色选择器包含所有角色（包括super_admin）

## 新增需求 (2026-03-18 第二批)

### 需求6：审核流程通知
- [x] 后端：提交审核时自动通知审核人员（admin/super_admin）— kbReview.submitForReview触发
- [x] 后端：审核完成（通过/驳回）时自动通知提交者 — kbReview.approve/reject触发
- [x] 后端：创建notifications表存储站内通知 — drizzle migration 0035
- [x] 前端：通知铃铛图标+未读数量Badge — NotificationBell组件
- [x] 前端：通知下拉列表展示通知内容（标题、内容、时间）
- [x] 前端：标记已读/全部已读功能
- [x] 前端：DashboardLayout集成NotificationBell（移动端+桌面端）

### 需求7：角色权限细粒度控制
- [x] 数据库：扩展rolePermissions表新增detailedPermissions列（JSON存储操作级+二级模块权限）— migration 0034
- [x] shared/const：新增SUB_MODULES定义（knowledge下6个二级模块、listing下5个、dev下4个、admin下3个）
- [x] shared/const：新增PERMISSION_OPERATIONS = ['read', 'edit', 'delete']
- [x] 后端：roleManagement router支持操作级+二级模块权限的读写
- [x] 前端：RoleManagement页面支持操作级权限编辑（read/edit/delete复选框）
- [x] 前端：RoleManagement页面支持二级模块展开编辑（可折叠子模块列表）

### 需求8：超管/公司管理员查看所有项目
- [x] 后端：project router修改，super_admin和admin角色调用getAllProjects查看所有项目
- [x] 后端：devProject router修改，super_admin和admin角色调用getAllDevProjects查看所有项目
- [x] 后端：管理员可更新/删除任意项目（getProjectByIdAdmin/getDevProjectByIdAdmin）
- [x] 前端：Home.tsx项目卡片增加创建者名称显示（仅管理员可见）
- [x] 前端：DevDashboard.tsx项目列表增加创建者名称显示（仅管理员可见）
- [x] 前端：非管理员保持现有逻辑（只看自己的项目）

### 测试
- [x] 24个新Vitest测试全部通过（phase5.test.ts）
- [x] 全部83个测试文件、2186个测试全部通过
- [x] TypeScript零错误

### 删除：模块二图片识别功能
- [x] 删除侧边栏"图片识别"菜单项（DashboardLayout.tsx）
- [x] 删除图片识别页面路由（App.tsx + legacy redirect）
- [x] 删除图片识别页面文件（ImageAnalysisPage.tsx）
- [x] 删除后端imageAnalysis router和db helpers
- [x] 删除ProjectDetailPage工作流程中的图片识别卡片，更新步骤编号
- [x] 清理测试文件中的imageAnalysis引用
- [x] 全部83个测试文件、2184个测试通过，TS零错误

## 新增需求 (2026-03-18 第三批)

### 需求9：权限前端拦截
- [x] 创建usePermissions Hook（读取当前用户角色权限配置）
- [x] 各页面根据操作权限动态隐藏编辑/删除按钮（KBProducts/KBListings/KBImages/KBVideos/KBSkills/DevProjects/Home）
- [x] 知识库页面集成权限拦截（提交审核按钮+删除按钮）
- [x] 项目管理页面集成权限拦截（模块一DevProjects删除按钮+模块二Home删除按钮）

### 需求10：模块一项目管理修复+删除功能
- [x] 修复模块一stats接口：admin/super_admin传null userId获取全部项目统计
- [x] devDb.getDevProjectStats支持userId为null时查询所有项目
- [x] 模块一项目删除功能已存在（DevProjects.tsx已有删除确认弹窗+后端delete API）

### 需求11：清理image_analyses数据库表
- [x] 从drizzle/schema.ts移除imageAnalyses表定义
- [x] 生成migration 0036_legal_gargoyle.sql
- [x] 执行DROP TABLE imageAnalyses清理数据库

### Bug修复：关键词管理页面Unicode显示问题
- [x] 修复词根分类Tab中标题和描述显示为Unicode转义字符（如\u7b56\u7565）的问题
- [x] 确保中文字符正确渲染而非显示为\uXXXX编码

## 新增需求 (2026-03-18 第四批)

### 需求12：本品属性表"从产品画像导入"功能
- [x] 后端：查询当前用户被分配的模块一项目列表API（通过project_assignments表，已有listImportableDevProjects）
- [x] 后端：获取模块一项目的产品画像数据API（已有getDevProjectProfile）
- [x] 后端：importFromProfile将产品画像数据转换为本品属性表格式并运行Rufus分析
- [x] 前端：DataFilesPage本品属性表区域添加“从产品画像导入”按钮
- [x] 前端：ImportFromProfileButton组件（弹窗选择项目+预览数据+确认导入）
- [x] 前端：选择后自动导入产品画像数据并运行AI分析填充到本品属性表
- [x] 测试：Vitest测试覆盖跨模块数据导入逻辑（14测试通过）

### Bug修复：项目分配列表不显示记录
- [x] 诊断原因：前端传pageSize=200超过后端限制的100，导致zod验证失败
- [x] 修复：将pageSize从200改为100

### Bug修复：模块一项目列表页面不显示项目
- [x] 诊断原因：路由/dev/projects指向了静态占位页DevProjectList.tsx，而非有数据查询的DevProjects.tsx
- [x] 修复：App.tsx路由从DevProjectList改为DevProjects组件

### 需求13：项目分配页面增加分页功能
- [x] 后端：项目分配列表API已支持page/pageSize参数（已有）
- [x] 前端：添加分页控件（首页/上一页/页码/下一页/末页），切换筛选时自动重置到第1页

### 需求14：清理无用代码文件
- [x] 删除DevProjectList.tsx占位文件（33行，已被DevProjects.tsx替代）
- [x] 删除ComponentShowcase.tsx（1437行，UI展示页，无任何引用）
- [x] 删除ManusDialog.tsx（89行，无任何组件引用）
- [x] 全面扫描确认无其他无用文件（hooks/contexts/shared/server均有引用）
- [x] 验证：TSC编译0错误，84测试文件2198测试全部通过

### Bug修复：角色管理子模块与实际侧边栏不一致
- [x] 检查所有模块的实际侧边栏子模块（DashboardLayout.tsx）
- [x] 对比角色管理中配置的子模块（shared/const.ts SUB_MODULES）
- [x] 修复所有模块的子模块配置：
  - dev: 3→5个（新增仪表盘、新建项目、项目列表、产品对比、供应商库）
  - listing: 3→12个（新增项目管理、竞品分析、竞品对比、导入历史、评论聚合分析、广告架构、数据文件、Listing生成、结果预览、Listing评分、智能图片建议）
  - ops: 4→5个（新增运营仪表盘）
  - service: 2→5个（新增售后仪表盘、邮件模板、客户画像）
  - knowledge: 5→6个（新增知识库总览，标签名更新为智能前缀）
  - admin: 5→6个（新增SOP权限）
- [x] 更新数据库中旧的子模块ID（listing_create→listing_generate、listing_optimize→listing_score）
- [x] 更新ALL_MODULES描述信息与实际子模块一致
- [x] TSC编译0错误，2198测试全部通过

### 需求15：角色管理一键授予所有子模块权限
- [x] 分析现有权限编辑流程（editDetailedPerms数据结构）
- [x] 添加“一键全部授权”按钮（绿色）和“清除全部”按钮（红色）到权限编辑弹窗
- [x] 点击后自动勾选所有模块及其所有子模块的读/编辑/删除权限，并展开所有模块显示结果
- [x] TSC编译0错误，2198测试全部通过

### 需求16：路由级权限拦截
- [x] 分析现有路由结构和usePermissions hook
- [x] 创建PermissionGuard路由守卫组件（支持自动检测和手动指定模块/子模块）
- [x] 建立ROUTE_PERMISSION_MAP路由映射表（40+路由→模块/子模块映射，支持动态路由参数）
- [x] 将PermissionGuard集成到App.tsx所有模块路由（dev/listing/knowledge/ops/service/admin）
- [x] 无权限时显示友好的403页面（盾牌图标+模块名称+返回/首页按钮）
- [x] TSC编译0错误，84测试文件2198测试全部通过

### 需求17：designer角色可查看所有项目的图片建议
- [x] 分析Listing项目列表查询逻辑（后端list procedure）
- [x] 分析图片建议页面的数据查询逻辑
- [x] 后端：project.list - designer角色返回所有项目（getAllProjects）
- [x] 后端：project.getById - designer角色可访问任意项目详情
- [x] 后端：listing.ts所有查询/变更接口 - resolveProjectAccess统一处理角色访问
- [x] 后端：ensureWriteAccess写保护 - designer不能修改他人项目（18个mutation端点保护）
- [x] 新增designerAccess.test.ts - 14个测试覆盖角色访问和写保护逻辑
- [x] TSC编译0错误，85测试文件2212测试全部通过

### Bug修复：designer查看他人项目数据为空（模块一+模块二）
- [x] 排查模块二 imageWorkflow 20+处getImageWorkflowSession按userId过滤
- [x] 排查模块一 devProject/devAnalysis/devBom/devManual/devProfile/devScoring 16处getDevProjectById按userId过滤
- [x] 修复 imageWorkflow: 新增getImageWorkflowSessionByProject()不按userId过滤，新增resolveSessionAccess/resolveProjectAccess统一处理
- [x] 修复 devProject: list/getById/stats开放给designer，uploadFile/confirmData/unconfirmData/updateFileRows加写保护
- [x] 修复 devAnalysis(8处)/devBom(3处)/devManual(2处)/devProfile(2处)/devScoring(1处) - 统一使用resolveDevProjectAccess
- [x] imageWorkflow 21个mutation端点全部加ensureWriteAccess写保护
- [x] TSC编译0错误，85测试文件2212测试全部通过

### 需求18：知识库图片模块 - 重新爬取、手动上传图片、重新AI分析
- [x] 排查现有图片爬取和分析的后端逻辑（kbImages路由和db层）
- [x] 后端：reCrawlByPosition - 按模块（主图/副图/A+/品牌故事）选择性重新爬取，清除旧图片后重新爬取
- [x] 后端：uploadImages - 手动上传图片到指定位置（base64上传到S3，最多20张）
- [x] 后端：reAnalyze - 重新运行AI分析（单图12维度分析+整体策略分析）
- [x] 后端：deleteImage - 删除单张图片
- [x] 后端：deleteImagesByPosition db函数 + deleteImage db函数
- [x] 前端：操作工具栏（重新爬取/上传图片/重新AI分析三个按钮）
- [x] 前端：重新爬取面板 - 勾选模块（主图/副图/A+/品牌故事）显示现有数量
- [x] 前端：上传图片面板 - 拖拽/点击上传，选择位置，预览缩略图可删除
- [x] TSC编译0错误，86测试文件2221测试全部通过

### 需求19：图片卡片添加删除按钮
- [x] 在ImageCardEnhanced组件右上角添加删除按钮（hover显示，红色圆形X按钮）
- [x] 点击删除按钮弹出确认提示后调用deleteImage API
- [x] 权限控制：仅allowEdit时显示删除按钮，避免aplusModuleType徽章位置冲突
- [x] TSC编译0错误，86测试文件2221测试全部通过

### 需求20：图片分组内拖拽排序
- [x] 排查positionIndex字段和现有排序逻辑
- [x] 安装@dnd-kit/core + @dnd-kit/sortable + @dnd-kit/utilities
- [x] 后端：reorderImages API + kbDb.reorderImages函数
- [x] 前端：SortableImageGrid + SortableImageCard组件，4个分组均支持拖拽
- [x] 拖拽完成后自动调用reorderImages保存新顺序
- [x] 权限控制：仅allowEdit时启用拖拽，分组标题显示“拖拽排序”提示
- [x] DragOverlay拖拽预览（缩略图+阴影）
- [x] TSC编译0错误，86测试文件2221测试全部通过

### 需求21：知识库模块统一优化（按架构方案v2）

#### 第一阶段：基础设施
- [x] 数据库：新增kb_intel_sources表（情报源配置）
- [x] 数据库：新增kb_intel_items表（采集到的情报条目）
- [x] 数据库：新增kb_call_logs表（知识库调用日志）
- [x] 数据库：新增kb_feedback表（用户反馈）
- [x] 数据库：新增kb_bot_conversations表（AI机器人对话）
- [x] 数据库：新增kb_bot_messages表（对话消息）
- [x] 后端：kbContextEngine.ts 三层加载核心服务（L1索引/L2摘要/L3详情）
- [x] 后端：5个知识库子模块list查询增加scope参数（mine/shared/all）+ kbSearch scope支持
- [x] 前端：5个知识库列表页增加KBScopeToggle组件（“我的”/“全部共享”切换）

#### 第二阶段：AI机器人
- [x] 后端：kbBot router（chat/listConversations/getHistory/deleteConversation/clearAll/updateTitle）
- [x] 后端：kbBot.chat集成kbContextEngine三层加载（L1索引→AI筛选→L2摘要→AI筛选→L3详情→AI生成回答）
- [x] 前端：AI机器人对话界面（左侧对话列表+右侧聊天窗口+建议提示词）
- [x] 前端：引用来源卡片（可展开查看原文/点击跳转详情页/类型图标+颜色区分）
- [x] 前端：检索路径可视化（L1→L2→L3扫描/匹配/token统计，可展开折叠）
- [x] 后端测试：32个测试用例全部通过（路由注册/输入验证/smartRoute/formatForPrompt/类型结构）

#### 第三阶段：外部情报采集
- [x] 后端：kbIntel router（12个API端点：情报源CRUD + 触发爬取 + 条目列表/详情/忽略/删除 + AI评估 + AI格式化 + 采纳入库）
- [x] 后端：AI质量评估（5维度打分：相关性/实操性/时效性/深度/独特性，加权总分）
- [x] 后端：AI格式化为标准SOP结构的Prompt（根据目标库类型生成不同格式）
- [x] 后端：adoptItem流程（AI格式化→用户编辑预览→确认录入对应知识库表）
- [x] 前端：情报推荐中心页面（情报源管理Dialog + 推荐列表 + 质量分/状态Badge + 审核/采纳/忽略操作）
- [x] 前端：AI格式化预览+编辑+确认录入界面（SopPreview组件，支持JSON结构化编辑）
- [x] 后端测试：22个测试用例全部通过（输入验证/评估分数计算/格式化结构/路由注册）

#### 第四阶段：反馈闭环
- [x] 后端：kbFeedback router（5个API端点：submitFeedback/getStats/getTopReferenced/getOverviewStats/getRecentFeedback）
- [x] 前端：AI回答中的反馈按钮（有用/不相关/错误三种评价，错误支持输入评论）
- [x] 前端：知识库概览页AI助手+情报快捷入口卡片 + 反馈统计面板（反馈分布条/热门引用TOP5）
- [x] 后端测试：22个测试用例全部通过（输入验证/分布计算/类型映射/统计结构/路由注册）

#### 情报源定时自动采集
- [x] 后端：扩展kb_intel_sources表添加定时采集字段（8个新字段：autoCollectEnabled/Interval/Cron/MaxItems/autoEvaluateEnabled/lastAutoCollectAt/nextAutoCollectAt/consecutiveFailures）
- [x] 后端：定时任务调度器（IntelScheduler类，服务启动时自动加载，60秒检查一次，支持动态增删改调度）
- [x] 后端：自动采集worker（轮询→URL爬取→去重→自动AI评估→质量阈值筛选→推送通知，连续失败5次自动暂停）
- [x] 后端：采集日志表（kb_intel_collect_logs）记录每次采集结果（发现/新增/重复/评估/推荐/耗时/错误）
- [x] 后端：kbIntel路由扩展（updateAutoCollect/triggerAutoCollect/getCollectLogs/getSchedulerStatus 4个新端点）
- [x] 前端：情报源卡片内联定时采集配置（Switch开关/频率选择/最大条目/自动评估/立即采集按钮）
- [x] 前端：采集日志Tab（状态Badge/触发类型/统计数据/分页/来源筛选） + 定时任务Tab（调度器状态/任务列表/说明卡片）
- [x] 后端测试：37个测试用例全部通过（间隔计算/失败跟踪/日志状态/质量阈值/通知格式/输入验证）

#### 知无不言情报源适配
- [x] 分析知无不言网站页面结构和内容格式（aw-item列表+markitup-box内容+回答需登录）
- [x] 优化爬虫适配知无不言网站（多行正则+aw-question-tags分类+title标签提取+curl回退+rawHtml传递）
- [x] 91个测试文件2354个测试全部通过（含20个知无不言解析器测试）

#### 更多行业情报源类型支持
- [x] 调研主流跨境电商信息源页面结构（雨果网cifnews可爬取、AMZ123为SPA不可爬、RSSHub被限流）
- [x] 后端：添加雨果网专用解析器（parseCifNewsListPage+parseCifNewsDetail，支持两种HTML属性顺序）
- [x] 后端：添加Amazon Seller Blog解析器（parseAmazonSellerBlog，过滤分类/标签页）
- [x] 后端：6个预设情报源模板（知无不言×3+雨果网×2+Amazon Blog×1）
- [x] 后端：getPresetSources/addPresetSource/addPresetSourceBatch 3个新端点
- [x] 前端：PresetSourcesPanel组件（可展开卡片+一键全部添加+已添加状态标记）
- [x] 92个测试文件2394个测试全部通过（含40个多源解析器测试）

### 模块三：领星ERP数据对接

#### Phase 1: 领星API Adapter Layer
- [x] 访问领星API文档，分析鉴权机制和MD5签名算法
- [x] 存储领星API密钥（LINGXING_APP_ID/LINGXING_APP_SECRET）
- [x] 数据库表：lingxing_config + lingxing_api_logs
- [x] 实现Token管理器（获取/自动刷新/过期重试）
- [x] 实现MD5签名生成器
- [x] 实现统一请求层（QPS控制/重试/超时/响应解析）
- [x] 实现Mock数据模式（未接入真实API前支持前端开发）
- [x] 数据缓存层（汇率/店铺列表等高频查询）

#### Phase 2: 库存预警模块
- [x] 数据库表：inventory_config + inventory_snapshots + sales_forecasts + replenishment_orders
- [x] 后端：FBA库存/本地仓数据获取
- [x] 后端：可售天数计算+补货参数配置
- [x] 后端：补货预警规则引擎
- [x] 前端：库存看板页面（/ops/inventory）
- [x] 前端：补货参数配置界面
- [x] 前端：库存预警列表+补货建议单

#### Phase 3: 利润分析模块
- [x] 数据库表：profit_snapshots + profit_analysis_results + profit_alert_rules
- [x] 后端：利润报表数据获取+汇率数据
- [x] 后端：成本明细解析+利润计算
- [x] 后端：AI异常费用预警+利润优化建议
- [x] 前端：利润看板页面（/ops/profit）
- [x] 前端：利润瀑布图（Recharts）
- [x] 前端：AI分析结果可编辑确认界面

#### Phase 4: 广告智能优化模块
- [x] 数据库表：ad_analysis_tasks + ad_automation_rules + search_term_actions
- [x] 后端：广告数据获取（SP/SB/SD）
- [x] 后端：搜索词报告获取+解析
- [x] 后端：AI搜索词分析+关键词策略建议
- [x] 后端：自动化规则引擎CRUD
- [x] 前端：广告看板页面（/ops/ads）
- [x] 前端：搜索词分析页+AI建议确认页
- [x] 前端：自动化规则管理页

#### Phase 5: 竞品监控模块
- [x] 数据库表：competitor_monitors + competitor_snapshots + competitor_reports
- [x] 后端：竞品ASIN管理CRUD
- [x] 后端：竞品数据录入/CSV导入
- [x] 后端：AI竞品分析报告生成
- [x] 前端：竞品监控页面（/ops/competitor）
- [x] 前端：竞品数据录入/导入界面
- [x] 前端：AI报告可编辑确认界面

#### Phase 6: AI增强
- [x] AI智能销量预测（保守/正常/乐观三场景）- 集成在利润分析AI中
- [x] AI异常费用检测 - 集成在利润分析AI中
- [x] 广告自动化规则执行引擎 - 规则CRUD已实现，执行引擎待接入真实API
- [x] 补货建议单AI生成 - 集成在库存预警AI中

#### 运营模块前端路由注册
- [x] 前端：运营仪表盘页面（/ops）
- [x] 前端：库存预警页面（/ops/inventory）
- [x] 前端：利润分析页面（/ops/profit）
- [x] 前端：广告优化页面（/ops/ads）
- [x] 前端：竞品监控页面（/ops/competitor）
- [x] App.tsx路由注册和DashboardLayout导航更新
- [x] 后端operations路由注册到主路由
- [x] 单元测试（17条通过）
- [x] TypeScript编译零错误

### 产品运营总览页面
- [x] 数据库表：product_profiles（产品主表，父ASIN+预算目标）
- [x] 数据库表：product_variants（子ASIN变体）
- [x] 数据库表：product_todos（待办任务）
- [x] 数据库表：product_logs（跟进日志）
- [x] 数据库表：keyword_monitors（关键词监控）
- [x] 数据库表：keyword_snapshots（关键词排名快照）
- [x] 后端：productOps路由（22个tRPC过程）
- [x] 后端：产品CRUD + 变体管理
- [x] 后端：待办任务CRUD + 状态管理
- [x] 后端：跟进日志CRUD
- [x] 后端：关键词监控CRUD + 排名快照
- [x] 后端：利润/库存/广告数据汇总（领星API聚合）
- [x] 后端：竞品监控数据关联查询
- [x] 前端：产品列表页（/ops/products）- 卡片布局+搜索+统计
- [x] 前端：产品详情页（/ops/products/:id）- 三栏布局
- [x] 前端：利润总览表（预计/实况预测/现时三列）
- [x] 前端：库存概览（FBA可售/在途/日均销量/可售天数）
- [x] 前端：广告概览（花费/销售额/ACoS/ROAS+活动列表）
- [x] 前端：右侧待办任务（可勾选完成+优先级+截止日期）
- [x] 前端：右侧跟进日志（时间线+多类型+添加表单）
- [x] 前端：底部竞品监控（关联competitor_monitors数据）
- [x] 前端：底部关键词监控（排名变化+添加/删除）
- [x] App.tsx路由注册 + DashboardLayout导航更新
- [x] 单元测试（4条通过）
- [x] TypeScript编译零错误

### 页面二：运营计划
- [ ] 数据库表：ops_plans（运营计划主表）
- [ ] 数据库表：ops_plan_actions（提升动作表，联动待办）
- [ ] 数据库表：ops_plan_summaries（执行总结表）
- [ ] 后端：运营计划CRUD + 现状数据读取
- [ ] 后端：提升动作CRUD + 自动创建待办联动
- [ ] 后端：执行总结CRUD
- [ ] 前端：运营计划页面（基础资料+现状数据+季度目标+提升计划表+执行总结）
- [ ] 前端：提升动作↔待办双向联动

### 页面三：转化率对比
- [x] 数据库表：conversion_comparisons（对比任务主表）
- [x] 数据库表：conversion_check_items（132项固定检查项+用户自定义项）
- [x] 数据库表：conversion_scores（评分表，支持锁定）
- [x] 数据库表：conversion_suggestions（AI优化建议表，支持编辑锁定）
- [x] 后端：对比任务CRUD + ASIN爬虫触发
- [x] 后端：检查项管理（固定模板+运营自定义添加维度+调整分数）
- [x] 后端：AI评分接口（爬虫数据→AI评分）
- [x] 后端：AI优化建议生成 + 一键同步到运营计划
- [x] 前端：转化率对比页面（ASIN输入+132项检查表+评分编辑锁定+AI建议编辑锁定）
- [x] 前端：优化建议→运营计划→待办三级联动

### 页面四：执行复盘
- [x] 数据库表：execution_reviews（复盘记录+多期对比）
- [x] 后端：复盘CRUD + AI复盘分析 + 达成率计算
- [x] 前端：执行复盘页面（多期数据对比+达成率可视化+AI分析建议）

### 页面五：团队协作看板
- [x] 数据库表：team_tasks（看板任务+状态流转）
- [x] 后端：看板任务CRUD + 状态流转 + 成员分配
- [x] 前端：团队协作看板页面（看板视图+列表视图+成员工作量统计）

### 页面整合
- [x] 五页Tab切换（数据看板/运营计划/转化率对比/执行复盘/团队协作看板）
- [x] 路由注册和导航更新
- [x] 教练角色改名为"游戏策划师"
- [x] 61个tRPC过程全部通过测试（2437条测试全部通过）

### Bug修复
- [x] 修复模块二智能图片建议页面React Error #31（对象被渲染为JSX子元素）

### 新功能批次
- [x] 功能1：竞品/关键词爬虫引擎（后端爬虫服务+定时任务+代理支持）
- [x] 功能2：产品详情页与运营仪表盘联动（产品排行点击跳转）
- [x] 功能3：待办任务到期提醒功能（通知提醒）
- [x] 功能4：领星API设置页面（独立配置界面，手动设置API密钥）
- [x] 功能5：转化率对比→运营计划一键同步联动（低分项批量同步为提升动作）
- [x] 功能6：团队协作看板增加甘特图视图（任务时间线+依赖关系）

## 爬虫引擎前端管理界面 (2026-03-23)
- [x] 前端：爬虫管理页面（任务列表、手动触发、结果查看）
- [x] 前端：注册路由和侧边栏导航入口
- [x] 测试：vitest覆盖爬虫管理页面相关功能

## 待办提醒自定义时间设置 (2026-03-23)
- [x] 数据库：productTodos表增加reminderDays字段
- [x] 后端：todoReminder服务支持按自定义提醒天数触发
- [x] 前端：待办任务创建/编辑时增加提醒时间选择器
- [x] 前端：待办列表中显示提醒状态标识
- [x] 测试：vitest覆盖自定义提醒时间功能

## 物流批次管理模块V2 (2026-03-23)
### Phase1: 数据库建表 + 后端CRUD API
- [x] DB: shipping_batches表（物流批次主表）
- [x] DB: batch_step_configs表（步骤配置/自定义时间）
- [x] DB: batch_products表（批次产品明细）
- [x] DB: batch_logs表（批次操作日志）
- [x] DB: step_time_history表（步骤时间历史/AI学习）
- [x] DB: replenishment_predictions表（补货预测）
- [x] DB: step_time_templates表（步骤时间模板）
- [x] 后端: shippingBatch router（CRUD + 步骤推进 + 验证规则）
### Phase2: 批次列表页 + 创建批次表单 + 9步进度条
- [x] 前端: 9步进度条组件（ShippingStepProgress）
- [x] 前端: 批次列表页（筛选/搜索/状态统计）
- [x] 前端: 创建批次表单（基本信息+产品选择+步骤时间配置）
### Phase3: 批次详情页
- [x] 前端: 三栏布局（财务+基本信息+日志）
- [x] 前端: 步骤操作区（步骤推进+必填验证+物流单号）
- [x] 前端: 库存追踪面板（数量变化+损耗率）
### Phase4: 领星API对接
- [x] 后端: 领星发货单/采购单/FBA库存/物流渠道API对接
### Phase5: 全链路库存流水线看板
- [x] 前端: 库存流水线看板组件（横向流程图+数字卡片）
### Phase6: AI补货预测引擎
- [x] 后端: 补货预测引擎（公式计算+LLM建议生成）
- [x] 前端: 补货预警面板（四级预警+建议查看+一键创建采购计划）
- [x] 后端: 补货提醒通知（定时任务+通知推送）
### Phase7: 库存预警页面联动
- [x] 前端: 库存预警页面增加在途库存/补货周期/预警等级列
### Phase8: 步骤时间模板 + AI时间学习
- [x] 前端: 系统设置增加物流时间模板配置
- [x] 后端: AI时间学习服务（加权平均+季节因子）
- [x] 前端: 超时预警标识（红色高亮+通知）
### 测试
- [x] vitest覆盖物流批次模块核心功能（36个测试全部通过）

## 领星API真实接口切换 + 代理配置

### 后端改造
- [x] 重构lingxingAdapter.ts：移除默认Mock=true，改为根据凭证自动判断
- [x] 新增领星API专用代理配置（category=lingxing_proxy），独立于爬虫代理
- [x] lingxingAdapter支持HTTP/HTTPS/SOCKS5代理转发所有领星API请求
- [x] 后端新增lingxing_proxy相关的存取/测试tRPC接口
- [x] 测试连接接口支持通过代理测试领星API连通性
- [x] Token获取和所有API请求均走代理
- [x] API调用日志增加usedProxy字段
- [x] 服务器启动时自动从DB加载代理配置（initLingxingAdapterFromDb）

### 前端改造
- [x] 系统设置-领星API页面新增"API代理配置"卡片
- [x] 支持配置代理协议/主机/端口/用户名/密码/完整URL
- [x] 支持一键测试"通过代理连接领星API"
- [x] 显示代理连接状态和出口IP
- [x] 状态Banner显示代理启用标识
- [x] API调用日志表格增加代理标记列

### 测试
- [x] vitest覆盖代理配置存取和领星API代理转发逻辑（2544测试全部通过）

## Bug修复：领星API凭证保存失败
- [x] 修复系统设置页面切换Tab后领星API凭证无法保存的问题
  - 根因：表单初始化仅从 dbConfig 取值，但 dbConfig 为空时未回退到 currentConfig
  - 修复：getConfig() 返回完整 appId，表单初始化优先级 dbConfig > currentConfig > 默认值
  - 增加环境变量提示 Banner 和密码掩码说明

## NextSLS物流API集成 — 反哺库存预警

### 后端——NextSLS适配器层
- [x] 创建NextSLS API适配器层（server/nextsls/adapter.ts）
- [x] 实现Bearer Token鉴权和请求封装
- [x] 实现16个API接口封装（运单创建/列表/详情/追踪/标签/账户/运费/地址库/偏远验证等）
- [x] API调用日志记录
- [x] DB配置加载初始化（initNextSlsAdapterFromDb）
- [x] 系统设置中增加NextSLS API凭证配置存取接口
- [x] tRPC路由开发（logistics router）

### 后端——物流时效统计服务
- [x] 创建物流时效统计服务（从NextSLS历史运单计算平均头程天数）
- [x] 按渠道/目的国统计平均运输时效
- [x] 缓存时效数据，定期刷新

### 后端——库存预警模块改造
- [x] 补货建议：头程运输天数从固定值改为NextSLS真实时效数据
- [x] 断货预警：基于真实物流轨迹动态计算预计到货时间
- [x] 物流批次管理：自动同步NextSLS运单状态和轨迹

### 前端
- [x] 系统设置增加NextSLS API配置Tab
- [x] 物流时效分析页面（按渠道/目的国显示平均天数）
- [x] 侧边栏新增“物流时效分析”导航项
- [x] 补货引擎步骤映射可视化

### 测试
- [x] NextSLS适配器单元测试（20个用例）
- [x] 物流时效统计服务测试
- [x] 全部2563个测试通过

## Bug修复：领星API签名错误 2001006
- [x] 修复领星API签名算法（api sign not correct）
  - 根因：领星使用CryptoJS的非标准AES密钥处理（不补0-pad到16字节），Node.js原生crypto无法复现
  - 修复：引入crypto-js npm包替代Node.js原生crypto的AES加密
  - 签名算法完全匹配领星官方测试页面的输出结果
  - 全部2565个测试通过（含官方参考数据验证用例）

## Bug修复：代理出口IP不固定
- [x] 修复代理出口IP不固定的问题
  - 根因：https-proxy-agent库在CONNECT隧道模式下出口IP不稳定（与代理服务器IP不一致）
  - 修复：用Node.js原生http.request CONNECT隧道替代https-proxy-agent
  - 改造范围：TokenManager.fetchToken、request方法、testProxyOnly、testConnection全部改用fetchViaProxy
  - SOCKS5代理保留原有socks-proxy-agent方式
  - 全部2565个测试通过

## Bug修复：CONNECT隧道响应解析 + 领星API响应格式不匹配
- [x] 修复fetchViaProxy响应解析和领星API响应格式不匹配问题
  - 根因1：手动解析HTTP响应（chunked编码）不可靠 → 改用Node.js http.request通过TLS socket自动处理
  - 根因2：领星API真实响应格式 {code:0, message:"success"}，代码预期 {code:"200", msg:"OK"}
  - 修复：添加normalizeLingxingResponse()函数统一转换响应格式
  - 验证：代理测试成功(IP:154.40.32.64)，API连接成功(获取28个卖家账号)，全2565测试通过

## Bug修复：领星API接口路径错误导致400"服务不存在"
- [x] 核对领星官方API文档，找出所有接口的正确路径
- [x] 修正代码中错误的API路径
  - 利润报表: /bd/profit/report/open/report/msku/list
  - FBA库存: /erp/sc/routing/fba/fbaStock/fbaList
  - SP广告: /pb/openapi/newad/spCampaigns
  - 搜索词: /pb/openapi/newad/spSearchTerms
  - 补货建议: /erp/sc/routing/restocking/analysis/getSummaryList
  - 发货单: /erp/sc/routing/storage/shipment/getShipmentList
  - 物流渠道: /erp/sc/routing/storage/logisticsChannel/getList
- [x] 修正利润字段映射（grossProfit, platformFee, totalFbaDeliveryFee, totalStorageFee, cgPriceAbsTotal等）
- [x] 验证: 利润报表✅ FBA库存✅ 广告需授权
- [x] 成本瀑布图真实数据展示正常

## 任务：领星API文档完整整理为项目文件
- [x] 从领星API文档网站抓取所有模块的接口信息（489个接口文档）
- [x] 将完整API文档整理为项目文件（shared/lingxing-api-docs/）
- [x] 包含所有模块：授权、基础数据、销售、FBA、补货建议、产品、采购、仓库、物涁、新广告、财务、统计等
- [x] 生成README.md索引文件
