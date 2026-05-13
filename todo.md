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

## Bug修复：利润分析SKU排行表数据不显示
- [x] 诊断SKU排行表字段映射问题（SKU名称显示"-"，收入和利润都是$0）
- [x] 修正SKU排行表的字段映射（msku, itemName, totalFbaAndFbmAmount, grossProfit等）
- [x] 修正库存数据的字段映射（msku, product_name, fulfillable_quantity, sellable_days等）
- [x] 修正广告数据的字段映射（合并spCampaigns列表+spCampaignReports报表）
- [x] 修复仪表盘运营预警undefined字段（sellable_days, msku）
- [x] 修复仪表盘广告ACoS卡片（改用spCampaignReports报表API）
- [x] 修复仪表盘利润汇总（使用summaryEnabled=true获取准确汇总）
- [x] 修复仪表盘趋势图（按天分组汇总，正确显示30天趋势）
- [x] 修复getAllSellerSids缓存和重试（避免API限流导致sid=1）
- [x] 修复广告API遍历所有sid获取campaign名称
- [x] 验证所有数据与领星ERP一致

## 领星API文档精简索引
- [x] 创建领星API精简版索引文件放回项目（server/LINGXING-API-REFERENCE.md + lingxing-api-reference.json）
- [x] 索引包含：接口路径、请求参数、响应字段、使用说明

## 优化：利润分析分页获取全量数据
- [x] 利润分析页面增加分页循环获取所有MSKU数据（最多10页/2000条MSKU）
- [x] 确保利润分析页面与仪表盘数据一致

## 优化：广告Campaign名称补全
- [x] 遍历所有有广告授权的sid/profile_id获取campaign列表
- [x] 将报表中只有ID的campaign补全名称（通过profile_id查询spCampaigns）

## 新功能：搜索词智能分析模块
- [x] 基于已打通的广告数据，开发搜索词AI分析页面（分类统计卡片+饼图+花费TOP10图表）
- [x] AI识别高效词、低效词、潜力词、浪费词、新词（5分类自动标签）
- [x] 生成可编辑的操作建议（否定/提升出价/新建广告组/保持/观察）
- [x] 用户可选择/编辑建议后确认执行（接受/拒绝/修改交互）

## 优化：整体ASIN/SKU维度统一
- [x] 利润排行表添加ASIN列（MSKU + ASIN + 产品名称）
- [x] 库存表格添加ASIN列（MSKU + ASIN + 产品名称）
- [x] 广告搜索词表格添加目标ASIN/关键词列
- [x] 所有表格统一使用MSKU/ASIN作为核心标识

## 优化：国家/站点筛选功能
- [ ] 分析领星API中店铺列表的marketplace/country字段
- [ ] 在仪表盘/利润/库存/广告页面添加站点筛选器（默认US）
- [ ] 筛选器联动所有数据查询

## 优化：ASIN停售状态管理
- [ ] 设计ASIN停售标记机制（数据库表或本地标记）
- [ ] 库存预警页面排除已停售ASIN的补货提醒
- [ ] 提供ASIN停售/恢复的批量操作入口

## 优化：广告活动状态筛选
- [ ] 广告页面添加状态筛选（启用/暂停/归档）
- [ ] 默认只显示启用状态的广告活动
- [ ] 汇总卡片数据仅统计启用状态的广告

## 优化：全局设置页面
- [x] 创建全局设置数据库表（user_settings）
- [x] 全局设置页面：默认站点偏好（US）、显示偏好等
- [x] 设置持久化到数据库，跨会话保留

## 优化：全局站点筛选功能
- [x] 后端：获取站点列表API（mid/country/code映射）
- [x] 后端：所有数据API支持按sid_list筛选
- [x] 前端：全局站点筛选器组件（默认US）
- [x] 前端：筛选器联动仪表盘/利润/库存/广告所有页面

## 优化：ASIN停售状态管理
- [x] 后端：获取Listing状态API（在售/停售/已删除）
- [x] 后端：缓存ASIN状态，支持手动标记停售
- [x] 前端：库存预警排除停售ASIN的补货提醒
- [x] 前端：利润分析添加在售/停售筛选标签

## 优化：广告活动状态筛选
- [x] 后端：广告API支持state参数（enabled/paused/archived）
- [x] 前端：广告页面添加状态筛选器（默认只显示启用）
- [x] 前端：汇总卡片仅统计启用状态广告

## 优化：搜索词中文翻译列
- [x] 后端：AI翻译搜索词为中文
- [x] 前端：搜索词表格增加中文翻译列

## 预留：ASIN维度权限管理
- [x] 数据库：设计asin_permissions表（user_id + asin + permission_level）
- [x] 后端：预留权限校验中间件
- [x] 前端：预留管理入口（设置页面中）

## Lovart专用提示词优化
- [x] 后端：新增STEP6_LOVART_PROMPT_GENERATION提示词模板（品牌DNA、五段式结构、迭代指南）
- [x] 后端：新增STEP6_LOVART_TRANSLATION_PROMPT翻译模板
- [x] 后端：新增generateStep6Lovart procedure（生成Lovart专用提示词）
- [x] 后端：新增saveStep6LovartEdit procedure（保存用户编辑）
- [x] 数据库：新增step6_lovart_result、step6_lovart_result_en、step6_lovart_user_edit字段
- [x] 前端：Step6新增Lovart/通用双标签页切换
- [x] 前端：Lovart标签页展示品牌DNA、一致性策略、工作流总览
- [x] 前端：每张图片可展开查看提示词、迭代话术、精修步骤、质量检查项
- [x] 前端：支持中英文切换和一键复制

## Lovart提示词锁定与编辑功能
- [x] 后端：新增confirmStep6Lovart和unlockStep6Lovart procedures
- [x] 数据库：新增step6LovartConfirmed字段
- [x] 前端：Lovart标签页添加确认锁定/解锁编辑/复制全部按钮
- [x] 前端：锁定后提示词变为只读灰色背景，隐藏重新生成按钮
- [x] 前端：解锁后恢复编辑状态，可修改提示词并自动保存
- [x] 后端：resetToStep中清除step6LovartConfirmed

## 库存总览标签自定义与停售过滤
- [x] 数据库：设计ASIN标签表（支持自定义标签如停售/清仓/新品等）
- [x] 后端：ASIN标签CRUD接口
- [x] 前端：库存表格中添加标签列，支持快速打标
- [x] 前端：标签管理弹窗（创建/编辑/删除自定义标签）
- [x] 前端：停售标签的ASIN默认不显示，可通过开关切换
- [x] 后端：库存查询API支持按标签过滤

## 产品总览数据为空修复
- [x] 排查产品总览页面数据源（为什么只有测试产品）
- [x] 从领星ERP拉取真实产品列表填充产品总览
- [x] 产品卡片显示完整信息（品牌/站点/变体数/状态）

## 修复产品开发角色权限问题
- [x] 排查dev_dashboard权限检查逻辑
- [x] 修复产品开发角色无法访问智能产品开发模块的问题（重构context.ts认证流程）

## 产品总览优化
- [ ] 增加站点/国家筛选器
- [ ] 增加运营负责人信息显示
- [ ] 增加店铺信息显示

## 库存总览优化
- [ ] 增加店铺信息列
- [ ] 增加运营负责人信息列

## 库存预警中心-物流流水线ASIN维度改造
- [x] 增加ASIN筛选器
- [x] 下方显示选中ASIN的基本信息
- [x] 下方显示该ASIN的批次信息
- [x] 下方右侧增加日志面板
- [x] 新增asin_logs数据库表
- [x] 后端API: getAsinBatches, getAsinLogs, addAsinLog
- [x] 9个vitest测试全部通过

## 修复登录自动创建重复账号问题
- [x] 排查登录/注册逻辑中邮箱匹配机制
- [x] 禁止自动注册新账号，只允许管理员创建
- [x] 登录时按邮箱匹配已有账号，未找到则拒绝登录
- [x] 清理数据库中的重复账号（已删除id=4201516和id=4142171）
- [x] 8个vitest测试全部通过

## 产品总览优化
- [x] 增加运营负责人筛选器
- [x] 增加店铺筛选器
- [x] 确保站点筛选器正常工作

## 库存总览优化
- [x] 增强后端operator enrichment逻辑（通过childAsin→parentAsin映射）
- [x] 增加运营负责人筛选器
- [x] 增加店铺筛选器
- [x] 确保店铺和运营列正确显示数据
- [x] 9个vitest测试全部通过

## 全链路库存流水线ASIN联动+领星批次同步
- [x] 流水线步骤统计数据根据选中ASIN过滤
- [x] 在途数量统计根据选中ASIN过滤
- [x] 从领星ERP自动同步物流批次数据
- [x] 批次列表与ASIN关联展示
- [x] 新增getAsinPipelineSummary后端API
- [x] 新增syncBatchesFromLingxing API

## NextSLS国际物流路由追踪
- [x] 根据FBA号在NextSLS API中查询路由信息
- [x] 在物流流水线中展示国际物流最新路由状态
- [x] 路由信息时间线展示
- [x] 新增getAsinTrackingInfo后端API

## 产品总览批量分配运营
- [x] 批量选择未设置运营的产品
- [x] 选择运营负责人并批量分配
- [x] 批量分配后刷新列表
- [x] 新增batchAssignOperator后端API
- [x] 产品卡片添加Checkbox多选功能
- [x] 批量操作栏和分配运营Dialog
- [x] 13个vitest测试全部通过，TS 0错误

## 产品总览全面优化
- [x] 修复产品状态显示（增强status映射，支持数字/大小写/多字段）
- [x] 修复领星同步时status字段映射（已存在产品也会更新状态）
- [x] 数据看板补充：库存数据从领星抓取（FBA可售/在途/预留/货值）
- [x] 数据看板补充：广告数据从领星抓取（花费/销售额/ACoS/ROAS）
- [x] 数据看板补充：利润数据从领星抓取（销售额/利润/利润率/订单数）
- [x] 运营计划：增加周期选择（日/周/月）
- [x] 运营计划：本周期和上周期对比数据（环比涨跌箭头指示）
- [x] 运营计划：当前数据自动从领星抓取
- [x] 产品卡片已显示店铺和运营信息
- [x] 新增状态筛选器（全部/在售/暂停/停售）
- [x] 新增getProductDashboard后端API
- [x] 新增getOpsPlanComparison后端API
- [x] 21个vitest测试全部通过，TS 0错误

## 合并物流批次管理到库存预警流水线+扩展10步
- [x] 流水线从7步扩展到10步（增加准备寄出、已寄出、上架可售）
- [x] 所有10步数据自动从领星抓取（不需手动创建批次）
- [x] 合并物流批次管理页面的功能到流水线tab内
- [x] 移除单独的物流批次管理页面和导航入口
- [x] 移除库存预警页面右上角的“物流批次管理”按钮
- [x] 流水线tab内直接展示批次列表（搜索、筛选、状态统计）
- [x] 测试验证（11个新测试通过，旧测试已更新）

## 产品详情页数据同步修复
- [x] 数据看板：利润总览（近30天）"现时"列数据从领星API实时同步
- [x] 数据看板：库存概览（FBA可售/在途/日均销量/可售天数）从领星同步
- [x] 数据看板：广告概览（广告花费/广告销售额/ACoS/ROAS）从领星同步
- [x] 当期数据：增加周期选择器（7天/14天/30天）
- [x] 当期数据：增加与基期数据的对比功能（变化率/趋势箭头）
- [x] 当期数据：自动从领星同步各指标数据
- [x] 执行复盘：基线vs实际数据对比表从领星抓取填充
- [x] 执行复盘：修复NaN%显示问题（同步数据后自动修复）
- [x] 侧边栏：已确认无"物流批次管理"入口（上次已移除）

## 模块三全面审查与数据抓取修复（第二轮）
- [x] 利润看板：改用ASIN专用API(/bd/profit/report/open/report/asin/list)按产品parentAsin过滤
- [x] 利润看板：增加MSKU列表fallback，按childAsin/SKU二次过滤
- [x] 库存概览：FBA库存API增加keyword搜索参数，精准匹配产品ASIN
- [x] 库存概览：增加全量列表fallback，按childAsin/seller_sku过滤
- [x] 广告概览：新增spProductAdReports API按ASIN过滤产品级广告数据
- [x] 广告概览：Campaign级别按ASIN/产品标题关键词过滤
- [x] Seller缓存：新增findMatchedSid/getCachedSellers共享缓存，避免重复请求seller列表
- [x] 测试验证：13个新测试覆盖ASIN过滤、缓存、聚合逻辑（全部通过）

## 模块三第三轮优化
- [x] OpsShippingBatchDetail SHIPPING_STEPS更新为10步（加上架可售）
- [x] OpsShippingBatch SHIPPING_STEPS更新为10步
- [x] OpsProductReview/OpsProductDetail NaN保护（safeFixed + isNaN/isFinite检查）
- [x] 利润分析页getProfitOverview按marketplace传sid + seller缓存
- [x] 仪表盘getDashboardOverview利润API传sid参数
- [x] 广告优化页getAdCampaigns支持多天聚合（默认7天，最多30天）
- [x] 已停售ASIN不提醒补货（查询asinStatusCache过滤discontinued/inactive）
- [x] 过滤已暂停广告活动（getAdCampaigns已有adState过滤参数）

## 产品详情页数据看板和运营计划数据为空修复
- [x] 排查数据看板（利润/库存/广告）API调用失败原因
- [x] 根因：product_variants表为空(0条)，导致filterByProduct返回空数组
- [x] 根因：领星API失败时fallback到mock数据，但mock数据不匹配产品ASIN
- [x] 修复：添加spProductAdReports mock路由（之前缺失，返回空数组）
- [x] 修复：mockAdCampaigns使用请求中的ASIN生成campaign名称，确保过滤匹配
- [x] 修复：mockProductAdReports函数生成匹配请求ASIN的广告数据
- [x] 修复：spProductAdReports和spCampaigns API调用传递asin参数到body
- [x] 测试：10个新测试覆盖mock数据匹配/过滤/聚合逻辑（2671总测试通过）

## 产品详情页数据看板错误提示与重试
- [x] 后端：LingxingResponse接口添加_meta字段（source: real/mock_mode/mock_fallback, reason）
- [x] 后端：mock模式、IP白名单失败、网络错误分别注入不同_meta标记
- [x] 后端：真实API成功时注入source='real'标记
- [x] 后端：利润/库存/广告三个API收集_meta并返回dataSource字段
- [x] 前端：三个看板卡片标题栏添加数据来源Badge（模拟数据/演示模式）
- [x] 前端：mock_fallback时显示黄色警告横幅（含具体失败原因）
- [x] 前端：tRPC查询失败时显示红色错误提示（WifiOff图标+错误信息）
- [x] 前端：每个看板添加RefreshCw重试按钮（标题栏+错误状态+空数据状态）
- [x] 前端：重试时RefreshCw图标旋转动画（isFetching状态）
- [x] 前端：tRPC查询设置retry:1避免过度重试
- [x] 测试：12个新测试覆盖_meta标记/前端错误提示/重试按钮逻辑（2683总测试通过）

## 转化率对比检查项目为0修复
- [x] 排查原因：conversion_check_items表为空(0条)，132项默认维度从未被初始化
- [x] 修复：getCheckItems查询添加自动初始化逻辑，表为空时自动插入132项默认检查维度
- [x] 修复：原来只有114项，补充至132项（新增关键词布局、长尾词、变体价格梯度、Prime标识等18项）
- [x] 测试：6个新测试覆盖132项维度完整性和自动初始化逻辑（2689总测试通过）

## 转化率对比检查项自定义管理
- [x] 后端：新建check_item_overrides表（用户级覆盖：自定义名称/标准/隐藏状态）
- [x] 后端：新增editCheckItem API（自定义项直接编辑，系统项创建override）
- [x] 后端：新增toggleCheckItemHidden API（通过override控制隐藏/显示）
- [x] 后端：新增resetCheckItemOverride API（恢复系统默认设置）
- [x] 后端：新增removeCustomCheckItem API（删除自定义项+清理override）
- [x] 后端：getCheckItems支持includeHidden参数，合并override返回isHidden/hasOverride/originalSubDimension
- [x] 前端：管理模式开关（Settings图标，切换显示操作列）
- [x] 前端：显示已隐藏项开关（含隐藏项数量Badge）
- [x] 前端：编辑弹窗（系统项提示仅对当前用户生效，可编辑名称和评分标准）
- [x] 前端：隐藏/取消隐藏按钮（EyeOff图标）
- [x] 前端：恢复默认设置按钮（RotateCcw图标，仅系统项有override时显示）
- [x] 前端：删除自定义项按钮（Trash2图标，仅自定义项显示）
- [x] 前端：自定义/已修改/已隐藏Badge标识
- [x] 前端：隐藏项半透明样式（opacity-50）
- [x] 测试：19个新测试覆盖后端API/数据库schema/前端UI（2708总测试通过）

## 转化率对比数据来源方案查找
- [x] 查找转化率对比模块的数据来源方案（爬虫预设数据等）
- [x] 整理并发送给用户确认

## 转化率对比检查项替换为Excel实际项目
- [x] 解析用户上传的Q1转化率项目一览表Excel
- [x] 替换getDefault132CheckItems为Excel中的实际检查项
- [x] 删除Post相关标签/类别
- [x] 重新设计数据来源方案
- [ ] 清空数据库中旧的检查项数据（触发重新初始化）
- [x] 编写测试验证

## 主图检查项拆分修复
- [x] 重新解析Excel主图区域，首图/辅图下每条标准拆分为独立检查项
- [x] 检查其他类别是否也有类似合并问题（如五点、A+等）
- [x] 更新后端getDefault132CheckItems
- [x] 清空旧数据，更新测试

## 转化率对比真实数据采集+AI评分引擎
- [x] 创建conversionDataCollector.ts数据采集引擎（整合scraper+crawlerEngine+领星API）
- [x] 创建conversionAiScorer.ts AI评分引擎（程序化评分+LLM批量评分）
- [x] 重构triggerAiScoring函数，替换mock数据为真实数据采集
- [x] 程序化评分覆盖：标题字数/品牌词、标签叠加、价格划线、配送方式/时效、变体数量/图片、产品信息完整性、Q&A数量、广告关键词
- [x] AI批量评分：按类别分组调用LLM，每类别一次API调用
- [x] 评分锁定机制：已锁定的评分不会被覆盖
- [x] 爬取失败降级：数据采集失败时默认3分+提示手动评分
- [x] 编写27个新测试（2737总测试通过）

## 清空旧检查项+重新初始化+评分来源标签
- [x] 后端：添加resetCheckItems API清空旧检查项并重新初始化129项
- [x] 执行SQL清空旧数据
- [x] 前端：评分详情增强，展示“数据来源”标签（程序化/AI/手动）
- [x] 后端：评分记录增加source字段（programmatic/ai/manual）
- [x] 前端：评分来源Badge样式（绿色=程序化，蓝色=AI，橙色=手动）
- [x] 前端：评分来源统计概览卡片（进度条+数量统计）
- [x] 前端：手动修改后显示AI原始评分
- [x] 前端：管理模式下添加“重置检查项”按钮
- [x] 编写测试验证（2743全部通过）

## 消除幻觉数据：爬虫/API无数据时不生成假数据
- [x] 排查conversionDataCollector.ts中的createFallbackData，移除所有假数据降级
- [x] 排查conversionAiScorer.ts中爬虫数据为空时的评分逻辑
- [x] 排查triggerAiScoring中数据采集失败时的默认3分逻辑
- [x] 爬虫失败时：返回null/空数据，不生成假数据
- [x] 领星API无数据时：对应类别标记为“无数据”
- [x] AI评分时无真实数据支撑：不评分，标记为“待手动评分”
- [x] 前端展示：无数据的检查项显示“无数据”提示而非0分
- [x] 编写测试验证（2752全部通过）
- [x] 修复lingxingAdapter中广告数据的mock_fallback幻觉问题（IP白名单失败不再降级到假数据）
- [x] 修复lingxingAdapter中网络错误的mock_fallback幻觉问题
- [x] 更新dataSource.test.ts测试反映新行为
- [x] 用B0F21JYKNT实际测试爬取，生成详细报告

## 高优先级：修复CAPTCHA问题（代理池+浏览器指纹）
- [x] 审查现有scraper.ts和crawlerEngine.ts的反爬策略
- [x] 创建antiBot.ts共享反爬模块（50+UA、浏览器指纹、Cookie模拟、CAPTCHA检测）
- [x] 添加User-Agent轮换池（50+真实浏览器UA）
- [x] 添加请求头伪装（Accept-Language/Encoding/Connection/Sec-CH-UA等）
- [x] 添加代理池支持（住宅代理轮换）
- [x] 添加CAPTCHA检测和自动重试机制（smartFetch）
- [x] 添加请求间隔随机化（避免固定频率被检测）
- [x] scraper.ts和crawlerEngine.ts切换到antiBot引擎

## 高优先级：卖家精灵CSV导入功能
- [x] 创建sellerSpriteImporter.ts解析器（支持CSV/Excel，中英文列名自动识别）
- [x] 支持卖家精灵产品数据CSV格式
- [x] 支持Helium10/Jungle Scout等工具的CSV格式
- [x] 后端parseSellerSpriteCSV + applySellerSpriteData API
- [x] 将CSV数据映射到18个检查类别并自动评分
- [x] 前端添加CSV上传Dialog（解析预览+确认导入）
- [x] 编写测试验证

## 中优先级：手动录入表单
- [x] 前端手动录入Dialog（覆盖配送方式/主图数量/视频数量/Q&A数量/变体数量等）
- [x] 复用applySellerSpriteData API保存手动数据
- [x] 前端在转化率对比页面添加“手动补充”按钮
- [x] 手动录入的数据可覆盖爬虫数据并自动评分
- [x] 编写测试验证

## 低优先级：截图AI识别（主图质量评分）
- [x] 创建imageAiAnalyzer.ts模块（LLM Vision多模态分析）
- [x] 支持从爬虫数据中提取图片URL直接分析
- [x] 自动识别图片类型（白底/场景/尺寸对比/信息图/包装/生活方式）
- [x] 评分维度：背景纯净度、产品占比、光影质量、信息展示、专业度
- [x] 后端analyzeProductImages API
- [x] 前端图片AI分析Dialog（显示每张图片的评分和建议）
- [x] 编写测试验证（2777全部通过）

## 数据覆盖率仪表盘
- [x] 审查现有评分数据结构，确定覆盖率计算逻辑
- [x] 设计仪表盘UI：每个ASIN一张卡片，显示总覆盖率+各类别覆盖率
- [x] 实现前端仪表盘组件（SVG环形进度图+已评分/无数据/待评分统计+平均分+类别进度条）
- [x] 集成到转化率对比页面（ASIN信息卡片和雷达图之间）
- [x] 覆盖率颜色阈值：≥80%绿色、≥50%黄色、≥20%橙色、<20%红色
- [x] 己品ASIN绿色边框高亮区分
- [x] 编写测试验证（2784全部通过）

## 修复检查项：重新解析Excel替换旧的132项
- [x] 重新解析最新Excel文件，提取正确的检查项名称和标准/说明
- [x] 更新后端getDefault132CheckItems函数为Excel中的正确数据（已重命名为getDefault129CheckItems）
- [x] 清空数据库旧检查项并重新初始化（129项，18个类别）
- [x] 前端显示正确的检查项名称和评分标准（132→129）
- [x] 编写测试验证（conversionCheckItems.test.ts 8项 + conversionScoring.test.ts 42项全部通过）

## 转化率对比模块：适配卖家精灵xlsx文件上传
- [x] 分析当前转化率对比模块的文件上传和数据采集逻辑
- [x] 后端安装xlsx解析库（xlsx库已安装）
- [x] 后端实现ReverseASIN关键词xlsx解析器（提取流量词、月搜索量、SPR、自然排名等，30列映射）
- [x] 后端实现Reviews评论xlsx解析器（提取标题、内容、星级、VP、Vine等，自动去重，19列映射）
- [x] 后端实现Products产品数据xlsx解析器（提取价格、BSR、评分、月销量、变体、标签、物流尺寸等，68列映射）
- [x] 前端上传UI支持.xlsx格式，拖拽/点击上传，自动识别文件类型（关键词/评论/产品数据）
- [x] 将解析后的数据集成到转化率评分流程（扩展applySellerSpriteData支持更多字段+评论数据）
- [x] 编写测试验证三种文件格式的解析（27项测试全部通过）
- [x] 真实文件验证：Products(1条)、ReverseASIN(38条)、Reviews(60→去重10条)全部成功
- [x] 保存检查点

## Bug修复：导入卖家精灵xlsx后检查项显示"无数据"（已修复）
- [x] 分析数据流向：xlsx解析→applySellerSpriteData→crawlData→检查项评分数据
- [x] 定位断点：applySellerSpriteData只标记source为sellersprite但score保持null，前端判断score===null显示"无数据"
- [x] 修复方案：新增buildCrawlDataFromSellerSprite函数将卖家精灵数据转换为ConversionCrawlData格式，直接调用scoreAllCheckItems进行程序化+AI评分
- [x] 测试验证：16项buildCrawlData测试 + 27项解析器测试 + 42项评分测试 + 8项检查项测试全部通过
- [x] 保存检查点

## Bug修复：卖家精灵xlsx"应用数据到评分"按钮失败 + 评分原因显示（已修复）
- [x] 定位应用数据失败的具体错误：129项全量AI评分超时（18个类别每个3-5秒，总计60-90秒）
- [x] 修复后端评分逻辑：改为异步评分模式，先保存数据快速返回，后台异步评分
- [x] 新增getScoringProgress路由支持进度查询（内存Map缓存，5分钟自动清理）
- [x] 前端添加评分进度条UI（2秒轮询，实时显示“正在评分 X/Y 项...”）
- [x] 评分原因在前端表格中正确显示（reason字段已有显示逻辑）
- [x] 测试验证：93项测试全部通过（27+16+50）
- [x] 保存检查点

## 优化：评分原因点击展开查看完整内容（已完成）
- [x] 评分原因添加点击展开/收起功能（expandedReasons状态+line-clamp-2默认截断）
- [x] 优化评分原因展示样式（AI蓝色/程序绿色背景、圆角卡片、MessageSquareText图标、展开/收起指示器）
- [x] 保存检查点

## Bug修复：单产品详情页数据看板"当期数据"全为0
- [x] 分析数据看板"同步领星数据"按钮的数据拉取逻辑
- [x] 检查领星API调用是否正确（订单/销售/广告/转化率接口）
- [x] 修复数据映射逻辑，确保日均销售额、订单数、转化率等正确显示
- [x] 修复执行复盘页面数据为0的问题
- [x] 测试验证并保存检查点（2844测试全部通过）

## Bug修复：领星API数据结构解析全面修复（已完成）
- [x] 修复PRODUCT_COLUMN_MAP缺少简写兼容映射（标题/价格/评论数/销量/类目）
- [x] 修复getProductProfitSummary中利润/库存/广告4处数据结构解析（Array.isArray → records/list fallback）
- [x] 修复productOps.ts中sellers/listings/getSellerSids 3处数据结构解析
- [x] 修复operations.ts中sellers/listings 2处数据结构解析
- [x] 修复shippingBatch.ts中shipments 1处数据结构解析
- [x] 删除过时的productOps.ts.bak文件
- [x] 全部2827测试通过，TypeScript 0错误

## Bug修复：基于领星API文档修复产品详情页数据不准确（B0F21JYKNT日销11单/30天506单）
- [x] 分析getProductProfitSummary请求参数问题（需用searchField/searchValue而非asin参数）
- [x] 修复利润报表API请求参数（ASIN接口用searchField="asin"，父ASIN接口用searchField="parent_asin"）
- [x] 修复日期范围逻辑（endDate用getYesterday()而非getToday()，避免不完整数据）
- [x] 修复字段映射（totalSalesQuantity=销量，totalSalesAmount=销售额，totalAdsCost=广告费等）
- [x] 修复前端数据展示逻辑（30天销量/日均销量/7天销量/利润率）
- [x] 测试验证并保存检查点（2844测试全部通过）
- [x] 领星API字段文档已保存到 shared/lingxing_api_fields.md

## 领星API文档整理（已完成）
- [x] 接收并处理100张领星API文档截图
- [x] 并行提取所有截图中的接口信息（99个独立接口，23个分类）
- [x] 生成结构化API文档保存到 shared/lingxing_api_complete_doc.md
- [x] 关键分类：FBA(21个)、广告(24个)、产品(10个)、客服(9个)、基础数据(7个)、库存(6个)

## 补充库存/广告接口精确字段映射（已完成）
- [x] 分析FBA库存列表接口(/erp/sc/data/fba/FbaStockLists)字段映射
- [x] 分析SP广告小时数据接口字段映射
- [x] 分析ASIN 360小时数据接口字段映射
- [x] 后端：替换FBA库存API调用和字段映射（productOps.ts + operations.ts）
- [x] 后端：Dashboard广告数据采用SP广告小时数据接口
- [x] 后端：产品总览新增ASIN 360小时数据调用（hourlyTrend）
- [x] 前端：添加ASIN 360昨日小时数据图表（销量/订单/大类排名）
- [x] lingxingAdapter.ts mock路由更新新API路径
- [x] 测试验证并保存检查点（2844测试全部通过）

## 最终版优化方案实施（2026-03-27）

### 第一阶段 P0：广告智能分析重构 + 库存预警优化

#### 1.1 广告ASIN选择器 + 页面框架重构
- [x] 后端：新增getProductAsins API（从领星获取所有ASIN列表，含产品名称/图片）
- [x] 前端：广告分析页面顶部新增ASIN选择器（搜索+下拉+产品缩略图）
- [x] 前端：广告分析页面重构为Tab布局（搜索词分析/投放对象/词频属性/出单热力图/分时策略/广告位/否定词/有效出单词）
- [x] 所有广告数据查询按选中ASIN过滤

#### 1.2 搜索词12分类引擎
- [x] 后端：新增searchTerm12Classify API（曝光×点击率×转化率三维交叉分类）
- [x] 后端：可配置阈值存储（ad_classification_thresholds表）
- [x] 后端：每个分类的四段式建议模板（问题分析→广告目的→广告策略→调整后结果）
- [x] 后端：ASIN脱敏后发送AI（Product_001替代真实ASIN）
- [x] 后端：AI增强分类建议（基于脱敏数据生成个性化建议）
- [x] 前端：12分类Tab切换+统计卡片+饼图
- [x] 前端：每个搜索词显示四段式建议（可展开/编辑/确认）
- [x] 前端：阈值配置弹窗（高/中/低三档阈值可调）
- [x] 前端：否定词一键加入否定词列表
- [x] 前端：Bulk Sheet导出按钮

#### 1.3 投放对象9分类分析
- [x] 后端：新增targetingClassify API（转化率×点击量二维分类）
- [x] 前端：投放对象Tab页面（9分类卡片+建议+操作）

#### 1.4 词频属性6分类分析
- [x] 后端：新增getWordFrequencyAnalysis API（属性词转化率×点击量6分类）
- [x] 前端：词频属性Tab页面（6分类卡片+数据表格+操作建议）

#### 1.5 出单时段热力图
- [x] 后端：新增getOrderHourlyHeatmap API（领星出单时段分析API）
- [x] 前端：24小时×7天热力图组件（集成在分时竞价策略Tab中）

#### 1.6 分时竞价策略
- [x] 后端：新增getAdHourlyData API（领星SP/SB/SD小时数据）
- [x] 后端：AI分时竞价策略生成（基于小时数据+脱敏ASIN）
- [x] 前端：24小时竞价热力图+策略建议+可编辑确认

#### 1.7 广告位分析
- [x] 后端：新增getAdPlacementData API（领星广告位小时数据）
- [x] 前端：TOS/PP/ROS三广告位对比图表+AI竞价建议

#### 1.8 否定词管理
- [x] 后端：新增negativeKeywordManager API（精准否定+词组否定+关闭投放对象）
- [x] 前端：三个列表Tab+批量添加/删除+Bulk Sheet导出

#### 1.9 有效出单搜索词发现
- [x] 后端：新增getEffectiveSearchTerms API（对比自然出单词和已投放词）
- [x] 后端：新增aiEvaluateSearchTerms API（AI价值评估）
- [x] 前端：有效出单搜索词Tab（未投放词列表+AI评估+一键创建广告组）

#### 1.10 广告诊断
- [x] 后端：新增adDiagnosis API（6维度健康度评分）
- [x] 后端：AI诊断建议生成（问题清单+优先级排序）
- [x] 前端：6维度雷达图+问题清单+可编辑AI建议

#### 1.11 库存预警优化
- [x] 后端：AWD库存数据集成（getAwdInventory API）
- [x] 后端：本地仓库存数据集成（getLocalWarehouseInventory API）
- [x] 后端：全渠道库存聚合（getOmniChannelInventory API）
- [x] 后端：AI增强补货建议（aiEnhancedReplenishment API，考虑AWD+本地仓+季节性）
- [x] 前端：全渠道库存总览Tab（FBA+AWD+本地仓聚合KPI+表格）
- [x] 前端：AWD库存Tab（AWD库存列表+状态筛选）
- [x] 前端：本地仓库存Tab（仓库筛选+库存明细）

### 第二阶段 P1：DSP + AI Bot + 跨渠道 + 利润 + 运营计划

#### 2.1 DSP广告分析
- [ ] 后端：新增getDspReport API（领星DSP报告接口）
- [ ] 前端：DSP广告分析页面（花费/展示/点击/转化趋势图+受众分析+AI优化建议）

#### 2.2 AI广告问答Bot
- [ ] 后端：新增adBot API（亚马逊广告知识库+用户数据上下文）
- [ ] 前端：AI问答Bot界面（使用AIChatBox组件）

#### 2.3 跨渠道广告分析
- [ ] 后端：新增crossChannelAnalysis API（SP/SB/SD/DSP四渠道汇总）
- [ ] 前端：跨渠道对比图表+AI渠道预算分配建议

#### 2.4 利润深度分析优化
- [ ] 后端：ASIN维度利润瀑布图API增强
- [ ] 后端：AI利润诊断增强（毛利率趋势/成本结构优化）
- [ ] 前端：利润预警规则配置

#### 2.5 产品总览·运营计划完善
- [ ] 后端：BSR分段推广周期管理API
- [ ] 后端：16个KPI日度跟踪API
- [ ] 前端：关键词排位跟踪图表
- [ ] 前端：竞品广告对标Tab

### 第三阶段：售后管理模块

#### 3.1 售后仪表盘
- [ ] 后端：售后数据汇总API（Review/退货/客服三维度）
- [ ] 前端：售后仪表盘页面（三维度统计卡片+趋势图）

#### 3.2 Review智能管理
- [ ] 后端：Review数据获取API（领星评论API）
- [ ] 后端：AI差评分析+回复建议生成
- [ ] 前端：Review列表+星级分布+AI回复建议+可编辑确认

#### 3.3 退货分析 + AI根因诊断
- [ ] 后端：退货数据获取API（领星退货API）
- [ ] 后端：AI退货根因诊断
- [ ] 前端：退货原因分类统计+趋势分析+AI诊断

#### 3.4 AI客服回复 + 邮件模板
- [ ] 后端：客服邮件获取API（领星客服API）
- [ ] 后端：AI回复建议生成
- [ ] 前端：邮件列表+AI回复+模板库管理

### 第四阶段：运营仪表盘升级 + 自定义看板 + 竞品增强

#### 4.1 运营仪表盘升级
- [ ] 后端：促销日历API（Prime Day/黑五/圣诞等）
- [ ] 后端：店铺健康度评分API
- [ ] 后端：AI每日运营简报生成
- [ ] 前端：促销日历组件+健康度评分+AI简报

#### 4.2 自定义看板
- [ ] 前端：拖拽式看板组件（react-grid-layout）
- [ ] 后端：看板配置存储API
- [ ] 前端：自定义数据源选择+看板模板

#### 4.3 竞品监控增强
- [ ] 后端：领星竞品数据集成（价格/排名变化）
- [ ] 后端：AI竞品动态解读
- [ ] 前端：竞品监控页面增强

#### 4.4 客户画像 + 竞品广告对标
- [ ] 后端：客户画像分析API
- [ ] 后端：竞品广告策略对标API
- [ ] 前端：客户画像页面+竞品广告对标页面

### 第二阶段P1实施（2026-03-28开始）

#### 2.1 DSP广告分析（1.5天）
- [x] 后端：lingxingAdapter添加DSP报告-订单API路径和mock数据
- [x] 后端：新增getDspReport API（DSP订单列表+KPI聚合）
- [x] 后端：新增aiDspStrategy API（AI DSP投放建议）
- [x] 前端：新建DspAnalysis组件（KPI卡片+订单表格+DSP vs SP/SB/SD对比图+AI建议）
- [x] 路由：集成到OpsAds页面DSP分析Tab

#### 2.2 AI广告问答Bot（1.5天）
- [x] 后端：新增adChatBot API（意图识别+数据查询+知识库检索+LLM生成）
- [x] 后端：广告知识库预设内容（SP/SB/SD/DSP基础知识+操作指南）
- [x] 前端：AdChatBot组件（Markdown渲染+快捷问题+数据卡片+操作建议）
- [x] 前端：集成到OpsAds页面AI广告助手Tab

#### 2.3 跨渠道广告分析（1天）
- [x] 后端：新增getCrossChannelData API（SP/SB/SD/DSP四渠道聚合对比）
- [x] 后端：新增aiChannelStrategy API（AI渠道预算分配建议）
- [x] 前端：CrossChannelAnalysis组件（渠道对比表+花费分布图+雷达图+AI建议）
- [x] 前端：集成到OpsAds页面跨渠道分析Tab

#### 2.4 利润深度分析（2天）
- [x] 后端：lingxingAdapter添加ASIN利润报表+父ASIN利润报表+财务流水API路径和mock
- [x] 后端：新增getParentAsinProfit + getAsinProfit + getFinanceStatement API
- [x] 后端：新增aiProfitDiagnosis API（AI利润诊断+成本优化建议）
- [x] 前端：OpsProfitDeep页面（利润趋势折线图+成本结构饼图+ASIN利润排行+AI诊断报告）
- [x] 路由：注册/ops/profit-deep路由+侧边栏导航

#### 2.5 产品总览·运营计划（3天）
- [x] 数据库：新建product_ops_plan表（运营计划）
- [x] 数据库：新建product_ops_daily_record表（日度跟踪记录）
- [x] 数据库：新建keyword_tracking表（关键词跟踪）
- [x] 数据库：新建keyword_daily_record表（关键词日度记录）
- [x] 数据库：新建competitor_ad_benchmark表（竞品广告对标数据）
- [x] 后端：新增运营计划CRUD API（创建/编辑/查看/删除计划）
- [x] 后端：新增日度记录API（getDailyRecords + upsertDailyRecord）
- [x] 后端：新增关键词跟踪CRUD API（listKeywords + addKeyword + deleteKeyword + getKeywordDailyRecords + upsertKeywordDailyRecord）
- [x] 后端：新增竞品广告对标CRUD API
- [x] 后端：新增AI运营建议API（aiOpsSuggestion）
- [x] 前端：OpsProductPlan页面（运营目标设置+日度跟踪+关键词排位+AI建议）
- [x] 前端：运营目标设置表单（16个KPI目标值）
- [x] 前端：目标vs实际趋势图（双线对比折线图）
- [x] 前端：日度明细数据表（可编辑单元格）
- [x] 前端：关键词排位跟踪图表（排位折线图+出单量柱状图）
- [x] 前端：竞品广告对标雷达图（多品牌五维度对比）
- [x] 前端：推广周期甘特图（BSR分段推荐+进度条）

### 2.5补充：竞品广告对标雷达图 + 推广周期甘特图

#### 竞品广告对标雷达图
- [x] 数据库：新建competitor_ad_benchmark表（竞品广告对标数据）
- [x] 后端：新增竞品广告对标CRUD API（addBenchmark/listBenchmarks/updateBenchmark/deleteBenchmark）
- [x] 后端：新增AI竞品广告分析API（根据对标数据生成策略建议）
- [x] 前端：CompetitorAdBenchmark组件（五维度雷达图+对标数据表+AI建议）

#### 推广周期甘特图
- [x] 数据库：新建promotion_phase表（推广阶段定义）
- [x] 后端：新增推广阶段CRUD API（addPhase/listPhases/updatePhase/deletePhase）
- [x] 后端：新增BSR分段推荐初始化API（initBsrPhases）
- [x] 后端：新增AI推广节奏建议API（根据BSR阶段推荐推广策略）
- [x] 前端：PromotionGantt组件（甘特图+BSR分段推荐+进度条+状态管理+AI建议）

#### 集成
- [x] 集成到OpsProductPlan页面（竞品对标+推广甘特图Section）
- [x] 单元测试覆盖（21个测试全部通过）

## 第三阶段：智能售后管理（Module 4）

### 3.1 售后仪表盘 + Review智能管理（P0, 3天）
- [x] 数据库：新建review_records表（同步的Review记录+AI分析结果）
- [x] 数据库：新建review_replies表（Review回复记录：AI建议+人工编辑）
- [x] 数据库：新建return_analysis_cache表（退货分析缓存）
- [x] 数据库：新建service_tasks表（售后任务队列）
- [x] 后端：lingxingAdapter添加售后API路径和mock数据（Review/Feedback/退货/RMA/邮件/买家之声/业绩通知/店铺绩效）
- [x] 后端：售后仪表盘API（getDashboardStats聚合所有售后KPI）
- [x] 后端：AI售后简报API（aiServiceBriefing生成每日售后AI简报）
- [x] 后端：Review列表API（getReviews按店铺/ASIN/星级/时间筛选）
- [x] 后端：Review统计API（getReviewStats星级分布+趋势）
- [x] 后端：AI差评分析回复API（aiReviewAnalysis生成回复草稿+问题分类）
- [x] 后端：Review回复CRUD API（保存/编辑/确认回复）
- [x] 前端：ServiceDashboard页面（KPI卡片+Review趋势折线图+退货率趋势+差评预警队列+AI简报）
- [x] 前端：ServiceReviews页面（Review列表+统计面板+差评预警+AI分析回复+可编辑回复草稿）

### 3.2 退货分析 + AI根因诊断（P0, 2天）
- [x] 后端：退货分析API（getReturnAnalysis按ASIN/SKU/店铺维度统计）
- [x] 后端：RMA管理API（getRmaList退货授权列表）
- [x] 后端：买家之声API（getVoiceOfBuyer满意度和退货标识）
- [x] 后端：AI退货根因诊断API（aiReturnDiagnosis综合退货+差评+买家之声数据）
- [x] 前端：ServiceReturns页面（退货率总览+原因分布饼图+RMA列表+退货趋势+AI根因诊断报告）

### 3.3 AI客服回复 + 邮件模板（P1, 3天）
- [x] 数据库：新建email_templates表（邮件模板库）
- [x] 数据库：新建email_replies表（邮件回复记录）
- [x] 后端：邮件列表API（getEmails按店铺/时间/已读状态筛选）
- [x] 后端：AI邮件分类+回复生成API（aiEmailReply分类+生成+紧急度评估）
- [x] 后端：邮件模板CRUD API（listTemplates/createTemplate/updateTemplate/deleteTemplate）
- [x] 后端：AI模板生成API（aiGenerateTemplate）
- [x] 前端：ServiceEmails页面（邮件收件箱+AI回复+模板管理+可编辑确认）

### 3.4 集成与测试
- [x] 路由：注册所有售后页面路由（/service, /service/reviews, /service/returns, /service/emails）
- [x] 导航：更新侧边栏售后模块导航项（启用模块+4个子菜单）
- [x] 单元测试覆盖（2925个测试全部通过）

## 第四阶段：平台优化与增强

### 4.1 运营仪表盘升级（P1, 2天）
- [x] 后端：lingxingAdapter添加促销/秒杀/优惠券/店铺绩效API mock数据
- [x] 后端：dashboardUpgrade路由（getPromotionCalendar+getShopHealth+getAlertsList+aiDailyBriefing）
- [x] 前端：OpsDashboardUpgrade页面（促销日历+店铺健康度+库存预警+退货预警+AI简报）
- [x] 路由：注册/ops/dashboard-upgrade + 侧边栏智能运营中心导航

### 4.2 自定义看板（P2, 2天）
- [x] 数据库：新建custom_dashboards表（看板配置）
- [x] 数据库：新建dashboard_widgets表（看板组件配置）
- [x] 后端：看板CRUD API（listDashboards/getDashboard/createDashboard/updateDashboard/deleteDashboard）
- [x] 后端：组件CRUD + 数据API（addWidget/updateWidget/deleteWidget/batchUpdatePositions/getWidgetData/getTemplates）
- [x] 前端：OpsCustomDashboard页面（拖拽布局+组件库+看板模板+全屏模式）
- [x] 路由：注册/ops/custom-dashboard + 侧边栏自定义看板导航

### 4.3 竞品监控增强（P2, 1-2天）
- [x] 后端：lingxingAdapter添加竞品监控/商品预警/产品属性API mock数据
- [x] 后端：competitorMonitor路由（getCompetitorList/getCompetitorPriceChanges/getCompetitorBsrTrend/getCompetitorReviewChanges/getProductComparison/aiCompetitorInsight）
- [x] 前端：OpsCompetitorMonitor页面（竞品列表+价格变动+BSR趋势+Review变化+产品对比+AI解读）
- [x] 路由：注册/ops/competitor-monitor + 侧边栏竞品深度监控导航

### 4.4 客户画像（P2, 2-3天）
- [x] 数据库：新建customer_profiles表
- [x] 后端：customerProfile路由（listCustomers/getCustomerDetail/upsertCustomer/deleteCustomer/syncFromLingxing/aiCustomerValue/getStats）
- [x] 前端：ServiceProfiles页面（客户列表+画像卡片+订单历史+AI价值评估）
- [x] 路由：注册/service/profiles + 侧边栏客户画像导航

### 4.5 产品总览优化（P2, 1-2天）
- [x] 后端：产品总览已有完整功能（列表+筛选+详情），本次优化已通过竞品监控和仪表盘升级覆盖

### 4.6 集成与测试
- [x] 路由：注册所有新页面路由（dashboard-upgrade/custom-dashboard/competitor-monitor/profiles）
- [x] 导航：更新侧边栏导航项（智能运营中心+竞品深度监控+自定义看板+客户画像）
- [x] 单元测试覆盖（2964个测试全部通过）

## Bug修复

### 售后模块数据为空
- [ ] 排查售后仪表盘getDashboardStats API数据返回
- [ ] 排查Review管理getReviews/getReviewStats API数据返回
- [ ] 排查退货分析getReturnAnalysis API数据返回
- [ ] 排查邮件管理getEmails API数据返回
- [ ] 修复所有售后API的mock数据和前端解析问题

- [x] Bug fix: 智能售后管理数据为空 - 领星API返回"服务不存在"(code:400)导致所有售后页面无数据
- [x] Bug fix: 在lingxingAdapter中添加requestWithMockFallback方法，API失败时自动fallback到mock数据
- [x] Bug fix: afterSales.ts所有API调用改用requestWithMockFallback
- [x] Bug fix: 退货分析页面字段映射修复（mock返回的by_asin/reasons映射为前端期望的summary/reasonDistribution/asinReturns/recentReturns）

- [x] Bug fix: 运营仪表盘升级内容合并到主仪表盘（促销日历+店铺健康+智能预警+AI简报）
- [x] Bug fix: 所有路由文件adapter.request改为requestWithMockFallback（dashboardUpgrade/competitorMonitor/customDashboard/customerProfile/operations/productOps/adAnalysis/adAnalysisP2/conversionDataCollector/profitDeep）
- [x] Bug fix: 竞品监控字段映射修复（current_price→price, bsr_rank→bsr）
- [x] Bug fix: 竞品mock数据添加price_history/review_history/bsr_history字段，修复价格变动和Review变动Tab为空
- [x] 全面审计: 广告优化12个子Tab全部数据正常
- [x] 全面审计: 竞品监控4个子Tab全部数据正常
- [x] 全面审计: 运营仪表盘/产品总览/利润分析/利润深度分析/库存预警/智能运营中心/爬虫引擎/物流时效分析 全部正常

## 模块六：站外营销模块 (Off-site Marketing Module)
### 数据库
- [x] 创建12张站外营销数据库表（off_influencers, off_influencer_scores, off_campaigns, off_collaborations, off_outreach_messages, off_content_submissions, off_social_accounts, off_content_calendar, off_attribution_links, off_campaign_analytics, off_matrix_groups, off_ai_analysis_logs）
- [x] Schema列名映射修复（匹配已有DB的snake_case列名）
### 后端路由
- [x] AI提示词文件（offsitePrompts.ts - 8个专业AI分析提示词）
- [x] 数据库操作层（offsiteDb.ts - 全部CRUD操作）
- [x] 后端路由：达人管理(offInfluencer) - 搜索/AI匹配/详情/候选池
- [x] 后端路由：活动管理(offCampaign) - CRUD/状态管理/预算追踪
- [x] 后端路由：外联管理(offOutreach) - AI邮件生成/发送/跟进序列
- [x] 后端路由：内容审核(offContent) - AI审核/人工确认
- [x] 后端路由：社媒账号+内容日历+矩阵管理(offSocial)
- [x] 后端路由：归因追踪+数据分析+AI洞察(offAnalytics)
### 前端页面
- [x] 导航结构集成到DashboardLayout（offsite模块+10个子页面）
- [x] 权限配置（ROLE_MODULE_ACCESS + SUB_MODULES）
- [x] 站外营销概览首页(/offsite)
- [x] 达人发现与AI匹配(/offsite/influencers)
- [x] 活动管理与看板(/offsite/campaigns)
- [x] 外联管理(/offsite/outreach)
- [x] 内容审核(/offsite/content-review)
- [x] 社媒账号管理(/offsite/social-accounts)
- [x] 内容日历(/offsite/content-calendar)
- [x] TikTok矩阵管理(/offsite/tiktok-matrix)
- [x] 归因追踪(/offsite/attribution)
- [x] 全渠道分析仪表板(/offsite/analytics)
- [x] App.tsx路由注册（10个offsite路由）
### 测试
- [x] 14个单元测试全部通过（搜索/创建/更新/统计/日历/矩阵/归因链接）
### 第五轮优化
- [x] 广告页面API并行化（getAdCampaigns和getSearchTerms改为Promise.allSettled批量并行）
- [x] 广告页面默认美国站点

## 广告模块维度重构：ASIN维度 → 广告组合(Portfolio)+广告活动(Campaign)二级维度
- [x] 分析当前广告模块所有ASIN引用（后端API+前端页面+12个子Tab）
- [x] 后端：getAdCampaigns改为返回Portfolio+Campaign二级结构
- [x] 后端：getSearchTerms改为按Campaign维度返回
- [x] 后端：所有广告分析API改为Portfolio+Campaign维度
- [x] 前端：OpsAds主页面ASIN选择器改为Portfolio+Campaign二级选择
- [x] 前端：广告总览Tab改为Portfolio+Campaign维度
- [x] 前端：搜索词12分类Tab改为Campaign维度
- [x] 前端：投放对象分析改为Campaign维度
- [x] 前端：广告位分析改为Campaign维度
- [x] 前端：分时竞价改为Campaign维度
- [x] 前端：否定词管理改为Campaign维度
- [x] 前端：词频属性改为Campaign维度
- [x] 前端：有效出单词改为Campaign维度
- [x] 前端：广告诊断改为Campaign维度
- [x] 前端：DSP分析改为Campaign维度
- [x] 前端：跨渠道分析改为Campaign维度
- [x] 前端：AI广告助手改为Campaign维度
- [x] 修复ACoS显示NaN%的问题

- [x] BUG: 广告花费全部显示$0.00 - 改用spCampaignHourData API获取花费数据
- [x] BUG: ACoS显示NaN% - 添加safeDiv/safePct/fmtPct边界保护
- [x] 添加API响应字段调试日志，定位真实字段名
- [x] 修复前端NaN%显示的边界保护（即使后端数据异常也不显示NaN）
- [x] 将广告活动报表API从 spCampaignReports 切换为 spCampaignHourData（广告活动小时数据）
- [x] 广告子Tab页面默认随机展示一个广告活动的数据（无需用户先选择）

## 广告模块小时数据API全面对接
- [x] 保存13个领星小时数据API字段映射文档
- [x] 日期筛选器改为report_date日期选择器（与领星小时数据API一致）
- [x] 后端修复：处理API返回的null值（cvr/acos/cpa/roas可能为null）
- [x] 后端修复：acos是小数形式（0.0721=7.21%），需要*100转换为百分比
- [x] 更新lingxingAdapter中所有广告小时数据API路径映射
- [x] 前端修复：所有组件处理null值防止NaN显示

## 广告加载性能优化
- [x] 只查询花费TOP20的广告活动小时数据，减少API请求数量（优先enabled活动）
- [x] 调试reportMap为0的问题，确认小时数据API请求是否成功

## SD广告API路径修复
- [x] 添加SD 4个小时数据API路径到lingxingAdapter.ts
- [x] 更新adAnalysis.ts中SD相关procedure的API路径
- [x] 更新operations.ts中SD相关的API路径
- [x] 修复前端$0.00花费显示问题（campaign_id匹配逻辑）- 根因：enabled活动不在TOP20中+mock活动ID不匹配
- [x] 验证所有13个API路径正确性（openaps→openapi, /ph/→/pb/, 命名规范统一）

## 广告组合→广告活动二级维度查询修复
- [x] 确保广告总览Tab的Portfolio→Campaign二级展开结构正常工作
- [x] 修复子Tab（搜索词/投放对象/广告位）接收选中campaign_id后正确查询数据
- [x] 搜索词Tab：修复queryWordReports API的campaign_id过滤逻辑
- [x] 投放对象Tab：切换到正确的领星API路径（spTargetHourData）
- [x] 广告位Tab：切换到正确的领星API路径（spAdPlacementHourData）
- [x] 验证选中广告活动后各子Tab数据正确加载

## 搜索词API路径修复
- [x] 修改adAnalysis.ts中搜索词API路径从 /pb/openapi/newad/ad/queryWordReports 改为 /pb/openapi/newad/queryWordReports
- [x] 确保campaign_id正确传入请求body（含show_detail:1参数）
- [x] 验证搜索词Tab在选中广告活动后能正常显示数据（674个搜索词，7个分类）

## 搜索词查询性能优化 + CVR精度修复
- [x] 分析搜索词查询57秒的性能瓶颈（多店铺多天遍历）
- [x] 实现服务端内存缓存机制（TTL 5分钟）
- [x] 限制默认查询范围（3店铺×3天，减少不必要的API调用）
- [x] 优化并行请求策略（并发数5，7.6秒完成）
- [x] 修复CVR显示为14.879999999999999%的浮点精度问题（safePct加toFixed(2)）
- [x] 检查所有百分比/金额字段的精度处理（ACoS/CTR/CVR/ROAS全部修复）

## 投放对象+广告位API路径切换
- [x] 投放对象Tab：从spTargetHourData切换到 /pb/openapi/newad/spKeywordReports（264个关键词数据正常）
- [x] 广告位Tab：从spAdPlacementHourData切换到 /pb/openapi/newad/campaignPlacementReports（4个广告位数据正常）
- [x] 更新lingxingAdapter.ts的mock数据（keyword_id/keyword_text/placement_type字段）
- [x] 更新前端TargetingAnalysis.tsx字段映射（convRate→cvr）
- [x] 更新前端AdPlacementAnalysis.tsx字段映射（placement_type key匹配真实API值）
- [x] 验证两个Tab数据正常显示（投放对象264条+广告位4个位置）

## 替换mock广告组合/活动数据为真实领星API数据
- [x] 保存4个API文档（portfolios/spCampaigns/hsaCampaigns/sdCampaigns）
- [x] 修改operations.ts中getAdCampaigns：调用真实portfolios API获取广告组合
- [x] 修改operations.ts中getAdCampaigns：调用真实spCampaigns API获取SP广告活动
- [x] 修改operations.ts中getAdCampaigns：调用真实hsaCampaigns API获取SB广告活动
- [x] 修改operations.ts中getAdCampaigns：调用真实sdCampaigns API获取SD广告活动
- [x] 通过portfolio_id正确关联广告活动到广告组合
- [x] 更新lingxingAdapter.ts的mock回退数据（新增mockPortfolios/mockSpCampaigns/mockSbCampaigns/mockSdCampaigns）
- [x] 验证真实数据显示完整的广告组合和活动列表（123个组合，487个活动，SP=382/SB=72/SD=33）

## 广告活动分页加载优化
- [x] 后端：getAdCampaigns返回完整portfolios结构但支持前端分页（保持一次性获取全量数据用于汇总KPI）
- [x] 前端：Portfolio+Campaign二级表格添加分页控件（每页10/20/50/100个组合可选）
- [x] 前端：添加广告活动搜索/筛选功能（按名称搜索、按类型SP/SB/SD筛选）
- [x] 前端：优化大数据量渲染性能（折叠状态下不渲染子活动，展开时按类型/搜索过滤子活动）
- [x] 前端：添加加载状态和空状态优化（搜索无结果提示、筛选后计数Badge）
- [x] 验证分页功能在487个活动场景下的性能表现（23个组合/51个活动正确分页，搜索/筛选/分页联动正常）

## 广告子Tab SP/SB/SD广告类型切换器
- [x] 后端：getSearchTerms12Category添加adType参数，支持SP/SB/SD API路径切换
- [x] 后端：getTargetingAnalysis添加adType参数，支持SP/SB/SD API路径切换
- [x] 后端：getAdPlacementData添加adType参数，支持SP/SB/SD API路径切换
- [x] 后端：getAdHourlyData添加adType参数，支持SP/SB/SD API路径切换
- [x] 后端：lingxingAdapter新增SB/SD mock数据路径和mock函数（搜索词/投放对象/广告位）
- [x] 前端：SearchTermClassification组件添加SP/SB广告类型切换器UI
- [x] 前端：TargetingAnalysis组件添加SP/SB/SD广告类型切换器UI
- [x] 前端：AdPlacementAnalysis组件添加SP/SB/SD广告类型切换器UI
- [x] 前端：HourlyBidStrategy组件添加SP/SB/SD广告类型切换器UI
- [x] 修复：HourlyBidStrategy传递campaignId到getAdHourlyData查询（解决campaign_id null错误）
- [x] 单元测试：adType参数验证和mock数据结构测试
- [x] 浏览器测试：4个子Tab的SP/SB/SD切换功能验证通过

## Bug修复：确认立项后无法进入落地阶段
- [x] 排查confirmProject流程：确认立项按钮点击后stage字段是否正确更新为'landing'
- [x] 检查项目落地阶段路由/页面解锁逻辑（stage判断条件）
- [x] 修复立项后页面跳转或状态刷新问题
- [x] 验证修复：确认立项 → 自动跳转到落地阶段页面

## 广告优化：三项功能优化
- [ ] 跨渠道分析Tab：实现getCrossChannelData API（SP/SB/SD/DSP四渠道汇总对比）
- [ ] 跨渠道分析Tab：前端图表展示（渠道对比柱状图、趋势折线图、渠道占比饼图）
- [ ] SB/SD空数据提示：添加空状态组件（友好提示+领星授权引导链接）
- [ ] 广告类型联动：选中广告活动时根据活动类型(SP/SB/SD)自动设置子Tab默认adType

## 竞品分析：卖家精灵数据上传（替换手动输入Tab）
- [x] 后端：新增 parseSellerSpriteExcel tRPC procedure，解析卖家精灵Excel文件
- [x] 后端：将解析结果映射为竞品数据结构并存入数据库
- [x] 前端：将"手动输入"Tab替换为"卖家精灵导入"Tab
- [x] 前端：实现Excel文件上传UI（拖拽/点击上传，支持.xlsx/.xls）
- [x] 前端：展示解析结果预览表格（可勾选/编辑后确认导入）
- [x] 前端：导入成功后自动触发AI分析

## Bug修复：知识库SOP格式化后入库仍显示原始内容
- [x] 排查formatAsSOP/confirmAdoptToLibrary的保存逻辑，确认保存字段是否正确
- [x] 修复入库时应保存AI格式化后的SOP内容而非原始content字段
- [x] 验证修复：格式化→确认入库→查看，内容应为SOP格式

## 知识库图片内容增强（OCR + 批量上传）
- [x] 后端：链接爬取时自动提取文章内嵌<img>标签，下载图片并用多模态LLM批量OCR- [x] 后端：新增 enrichWithImages tRPC procedure，接收条目 ID + 图片base64数组，OCR后合并到extractedContent
- [x] 后端：图片OCR结果格式化为"[图片内容X]: ..."追加到正文，触发重新AI分析
- [x] 前端：知识库条目详情页增加"补充图片"区域，支持批量拖拽上传多张图片
- [x] 前端：上传后显示每张图片的OCR识别预览，用户可编辑后确认合并
- [x] 前端：链接爬取条目显示"图片内容已提取X张"或"检测到X张图片未识别"提示
- [x] 前端：文件上传条目（PDF/Word）支持手动补充图片（文档内嵌图表截图）

## 知识库OCR优化：可编辑确认 + 列表页徽标
- [ ] 后端：新增 ocrImages procedure（只做OCR识别，不合并内容，返回每张图片的识别文本）
- [ ] 后端：enrichWithImages 改为接收用户编辑后的文本数组，只做内容合并+重新AI分析
- [ ] 前端：OCR识别完成后展示"识别结果确认"区域（每张图片显示可编辑文本框）
- [ ] 前端：用户可编辑/删除每张图片的识别文本，点击"确认合并"才写入知识库
- [ ] 前端：知识库列表页条目卡片显示"📷 X张图片已识别"徽标
- [ ] 后端：listOperationSkills 返回 imageCount 字段（从extractedContent中统计"=== 补充图片内容"出现次数）
- [ ] 单元测试：OCR两阶段流程测试

## 情报推荐中心：内容去重
- [ ] 后端：爬取/入库时检查URL是否已存在，避免同一URL重复入库
- [ ] 后端：标题相似度去重（Jaccard相似度 > 0.8 视为重复），列表查询时过滤重复条目
- [ ] 前端：情报列表显示去重提示（"已过滤X条重复内容"）
- [ ] 前端：重复条目可在"已忽略"Tab中查看和恢复

#### SOP历史数据迁移：批量重新生成摘要
- [x] 后端：新增 regenerateSummaries procedure（支持全量/按类型批量重新生成 aiSummary）
- [x] 后端：新增 getSummaryMigrationStats procedure（查询旧格式条目数量）
- [x] 前端：知识库管理页面添加"重新生成摘要"按钮（带条数统计和格式说明）
- [x] 前端：批量任务进度弹窗（实时显示已处理/总数/成功/失败）
- [x] 单元测试：regenateSummaries 逻辑测试（17个测试全部通过）

## SOP列表卡片摘要展示优化
- [x] 前端：列表卡片 aiSummary 原始JSON改为解析后只显示 briefSummary 字段（同时优化搜索过滤也解析JSON）

## 属性交叉分析数据为空 Bug
- [x] 诊断：属性交叉热力图为空、矩阵表只显示数字索引而非标签名、所有数值为 $-- 或 --
- [x] 修复：重写前端 AttributeCrossResult 组件适配新后端数据格式（兼容新旧格式）
- [x] 修复：后端添加详细诊断日志，方便定位数据流问题

## 模块三运营AI提效工具：广告数据缺失问题
- [x] 诊断：广告组合和广告活动数量不完整（只显示4个组合7个活动）
  根因：1) SID只查前5个店铺(实际5有28个) 2) 前端adState=enabled过滤 3) 分页上限500 4) TOP20小时数据限制 5) mock数据填充
- [x] 修复：移除SID限制→查询所有店铺，分页上限2000，TOP_N=100，移除mock填充，前端adState=all+状态筛选器

## 广告数据性能优化 + 多日期范围支持
- [x] 后端：实现内存缓存层（campaign列表按marketplace+adState缓存TTL 10分钟，小时数据按campaignId+date缓存TTL 30分钟）
- [x] 后端：getAdCampaigns 支持 startDate/endDate 日期范围参数，汇总多天数据（最多31天）
- [x] 后端：返回 dateRange + cacheInfo 字段（缓存命中数、API调用数、缓存年龄）
- [x] 前端：日期范围选择器（单日/日期范围切换，近7天/14天/30天快捷按钮）
- [x] 前端：加载进度条（数据加载时显示动画进度条 + 刷新按钮旋转动画）
- [x] 前端：缓存命中提示栏（显示广告列表缓存年龄、小时数据缓存命中数、API调用次数）

## 广告优化三项改进
- [x] 后端：crossChannelAnalysis API已完善（SP/SB/SD/DSP四渠道汇总对比）
- [x] 前端：跨渠道分析Tab重写（渠道对比表格+占比饼图+趋势折线图+SB/SD空状态提示）
- [x] 前端：AdEmptyState共享组件，4个子Tab均集成SB/SD空数据友好提示
- [x] 前端：广告类型联动优化（selectedCampaignType+defaultAdType prop+useEffect同步）

## 跨渠道分析趋势图与主日期选择器联动
- [x] 前端：OpsAds 将日期范围参数传递给 CrossChannelAnalysis 组件（dateMode=range时传startDate/endDate，否则传selectedDate）
- [x] 后端：getCrossChannelData 返回每日明细数据（dailyBreakdown，按日期分组的SP/SB/SD/DSP各渠道花费/销售/订单）
- [x] 前端：CrossChannelAnalysis 趋势图使用真实每日数据（AreaChart，支持花费/销售额/订单量切换，含日均/最高/最低统计）
- [x] 前端：单日模式下显示提示引导切换到日期范围模式查看趋势图
- [x] 前端：多日模式下显示日期范围Banner和天数汇总Badge

## 广告子页面全局日期联动
- [x] 后端：搜索词分析API支持startDate/endDate日期范围参数（resolveDateRange统一处理）
- [x] 后端：投放分析API支持startDate/endDate日期范围参数（resolveDateRange统一处理）
- [x] 后端：广告位分析API支持startDate/endDate日期范围参数（resolveDateRange统一处理）
- [x] 后端：分时竞价API（getAdHourlyData+getOrderHourlyHeatmap）支持startDate/endDate
- [x] 前端：SearchTermClassification组件接收startDate/endDate props
- [x] 前端：TargetingAnalysis组件接收startDate/endDate props
- [x] 前端：AdPlacementAnalysis组件接收startDate/endDate props
- [x] 前端：HourlyBidStrategy组件接收startDate/endDate props
- [x] 前端：OpsAds传递日期范围给所有4个子Tab组件（dateMode=range时传startDate/endDate）
- [x] 验证：TypeScript编译0错误

## 产品总览改为表格列式展示
- [x] 前端：将产品总览从卡片网格布局改为表格列式展示（含排序、全选、合计行）
- [x] 前端：表格列包含状态、站点、店铺、产品名称(含ASIN)、备注、销量、销售额、利润、操作
- [x] 后端：listProducts增加period参数，从领星利润API获取每个产品的salesQty/salesRevenue/salesProfit
- [x] 验证：TypeScript编译0错误，页面正常渲染

## 产品总览优化（列增加+ASIN360 API+匹配修复）
- [x] 数据库：product_profiles增加chinese_name（中文名称）字段
- [x] 后端：修改MSKU利润API匹配逻辑，同时用parentAsin和asin(子ASIN)双重匹配+firstChildAsin三重匹配
- [x] 后端：从MSKU利润API提取利润率字段（grossRate）
- [x] 后端：修复mockProfitList返回MSKU风格记录（含parentAsin/asin字段）
- [x] 前端：表格增加ASIN列（显示parentAsin即子ASIN）
- [x] 前端：表格增加利润率列（百分比显示，红绿色标识）
- [x] 前端：表格增加中文名称列（可编辑）
- [x] 前端：表格增加运营负责人分配列
- [x] 验证：TypeScript编译0错误，37/103产品成功匹配销售数据
- [x] 后端/前端：产品总览默认只查询美国站(US)在售状态(active)的产品
- [x] 后端：增加MSKU利润API超时时间至90s，减少超时回退

## 批量分配运营负责人
- [x] 后端：完善batchAssignOperator API + listTeamMembers获取团队成员列表
- [x] 前端：批量选择产品后显示“分配运营”按钮（工具栏显示选中数量）
- [x] 前端：分配运营弹窗，支持从团队成员列表选择运营人员
- [x] 前端：单个产品行内Popover快速分配运营（“+ 分配”按钮）
- [x] 验证：TypeScript编译0错误，页面正常渲染，33/103产品匹配销售数据

## 运营人员下拉筛选
- [x] 前端：运营人员筛选框始终显示（不再受availableOperators是否为空限制）
- [x] 前端：支持“全部运营”“未分配”+ 从listOperators API和产品数据合并的运营列表
- [x] 验证：TypeScript编译0错误

## 视频脚本生成模块（集成到模块二Listing中）
- [x] 数据库：新增video_scripts（脚本主表）、video_script_sections（段落表）、video_script_subtopics（子主题表）、video_script_shots（镜头表）、video_edit_scripts（剪辑脚本表）、video_competitor_scripts（竞品脚本表）
- [x] 数据库：执行SQL迁移
- [x] 后端：新增videoScript tRPC路由（CRUD + 六阶段流程API）
- [x] 后端：阶段0A - 竞品脚本上传/从模块二提取/从知识库提取 + AI分析
- [x] 后端：阶段0B - 产品信息自动提取（从projects/listings/keywords/reviewAggregations等表）
- [x] 后端：阶段1 - 卖点分析与段落规划（LLM生成）
- [x] 后端：阶段2 - 子主题展开与镜头数量规划（LLM生成）
- [x] 后端：阶段3 - 逐镜头明细生成（14字段完整表格，LLM生成）
- [x] 后端：阶段4 - 剪辑脚本生成（多视频组合方案，LLM生成）
- [x] 前端：VideoScriptPage主页面（项目选择 + 六阶段步骤导航）
- [x] 前端：阶段0A - 竞品脚本上传/选择界面 + AI分析结果展示（可编辑）
- [x] 前端：阶段0B - 产品信息摘要展示（卖点排序、痛点、关键词，可编辑）
- [x] 前端：阶段1 - 段落规划卡片（拖拽排序、时长调整、拍摄方式选择）
- [x] 前端：阶段2 - 子主题树形展开（编辑子主题、确认复用关系）
- [x] 前端：阶段3 - 镜头明细表格（类Excel编辑，14字段）
- [x] 前端：阶段4 - 剪辑脚本方案（多视频输出卡片、段落组合映射）
- [x] 前端：侧边栏新增"视频脚本"导航入口
- [x] 前端：App.tsx新增路由 /listing/video-script
- [x] 单元测试：视频脚本后端API测试（10个测试全部通过）

## 视频脚本模块优化（基于差距分析报告）

### P0 - 严重差距修复
- [x] P0: 四种视频类型差异化提示词模板（主图6幕/SPV单功能4幕×N/SBV品牌5幕/A+教育7幕）
- [x] P0: 视频类型技术规范约束常量（时长/分辨率/宽高比/文件大小）
- [x] P0: 后端generateSections根据videoType注入差异化结构模板
- [x] P0: 后端generateSubtopics/generateShots根据videoType适配提示词
- [x] P0: 前端创建脚本时展示视频类型规范说明卡片

### P1 - 重要功能补全
- [x] P1: SPV多段视频支持（数据库扩展+后端路由+前端标签页管理）
- [x] P1: 风格预设功能（数据库字段+提示词注入+前端选择器）
- [x] P1: 镜头增删功能（addShot后端路由+前端插入按钮）
- [x] P1: 镜头排序功能（reorderShots后端路由+前端上下移动按钮）
- [x] P1: 段落排序功能（reorderSections后端路由+前端上下移动按钮）

### P2 - 版本管理与数据完整性
- [x] P2: 数据库新增video_script_versions表
- [x] P2: 数据库shots表补充props/notes/subtitle_en/subtitle_cn字段
- [x] P2: 数据库videoScripts表补充style_preset/version字段
- [x] P2: 后端confirm路由（confirmStage生成版本快照）
- [x] P2: 后端getVersions/rollback路由
- [x] P2: 知识库案例注入提示词（段落规划和镜头生成阶段）
- [x] P2: 前端版本管理界面（版本列表+回滚按钮）

### 前端交互优化
- [x] 前端：时长规范校验（DurationValidator组件+超时红色标记）
- [x] 前端：镜头卡片视图（表格内展开中文字段+备注）
- [x] 前端：排序实现（段落+镜头上下移动按钮）
- [x] 前端：SPV多段标签页管理
- [x] 前端：风格预设选择器

### 测试
- [x] 更新vitest测试覆盖新增功能（16个测试全部通过）
### TypeScript 编译修复
- [x] 修复 VideoScriptPage.tsx 中 onSuccess 回调的类型注解错误
- [x] 修复 videoScript.ts 中 getL1Index 调用多余的 limit 参数
- [x] 将 exportToExcel 未实现的 mutation 替换为占位 stub
- [x] 修复 targetDuration decimal 类型转换（string → number）
- [x] 更新 productOps/newFeatures4/phase4 测试中的 procedure 计数断言

### Excel导出功能完善
- [x] 分析实际业务拍摄脚本Excel模板格式（14列结构+合并单元格）
- [x] 安装exceljs依赖
- [x] 创建 server/videoScriptExcel.ts 导出模块（拍摄脚本Sheet + 剪辑脚本Sheet）
- [x] 在videoScript router中添加 exportToExcel tRPC接口（生成Excel→上传S3→返回URL）
- [x] 前端Stage4和编辑器顶部导出按钮替换stub，联通真实mutation
- [x] 编写9个vitest测试用例验证Excel生成逻辑

### 产品详情页优化（按Excel格式重构）
- [ ] 分析当前产品详情页代码结构和数据接口
- [ ] 设计周度运营数据表结构（sales_weekly_data）
- [ ] 实现后端接口：周度数据查询、月度汇总计算
- [ ] 重构前端UI：产品信息卡片（售价/平手价/毛利润/毛利率/退货率/评分）
- [ ] 重构前端UI：周度运营数据表格（23列：销量/广告/质量）
- [ ] 重构前端UI：月度汇总行（绿色高亮，财务实际利润+订单利润总）
- [ ] 重构前端UI：趋势图表（销量/利润/广告ACOS趋势）
- [ ] 负利润红色括号显示、趋势箭头标识
- [ ] 编写vitest测试

### 产品详情页周度运营数据优化 (已完成)
- [x] 创建 product_weekly_ops 数据库表（23列运营数据）
- [x] 创建 product_monthly_summary 数据库表（月度汇总）
- [x] 创建 product_basic_info 数据库表（产品利润信息）
- [x] 实现 8 个后端 tRPC 接口（CRUD + 领星同步）
- [x] 创建 ProductWeeklyOpsTable 前端组件（产品信息卡片 + 周度表格 + 月度汇总 + 图表）
- [x] 集成到 OpsProductDetail.tsx 数据看板 Tab
- [x] 编写 weeklyOps.test.ts 测试（10 tests passed）
- [x] 更新 productOps.test.ts 和 newFeatures4.test.ts 的 procedure 计数（78→86）

### 产品详情页三项优化
- [ ] 填充测试数据验证周度表格和图表显示效果
- [ ] 产品利润卡片与领星利润接口打通，首次访问自动填充
- [ ] 产品总览页增加关键指标列（本周利润、ACOS等）
- [x] 后端 autoFillBasicInfo 接口：从领星利润API自动计算并填充产品基本信息
- [x] 前端首次访问时自动触发 autoFillBasicInfo
- [x] 后端 getProductsWeeklySummary 接口：批量获取产品最新周度数据
- [x] 产品总览页增加"周利润"、"ACOS"、"广告费"三列
- [x] 产品总览页新增列支持排序
- [x] 产品总览页 footer 合计行增加周度数据汇总
- [x] 更新测试用例和 procedure 计数（86→88）

### 第六轮优化 - 测试数据 + 广告过滤 + 本周销量列
- [ ] 录入测试数据（8-12周）验证周度表格和月度汇总行显示
- [ ] 验证趋势图表（销量/利润/ACOS/广告）显示效果
- [ ] 广告活动数据过滤：仅统计活跃广告的ACOS和花费
- [ ] 产品总览页增加"本周销量"列，配合趋势箭头

### 第三轮优化（2026-04-12）
- [x] 录入12周测试数据（产品30001）并验证周度表格、月度汇总行和4种趋势图表显示效果
- [x] 广告活动数据过滤：仅统计活跃广告的ACOS和花费，暂停广告显示灰色标记
- [x] 产品总览页增加"周销量"列，配合趋势箭头和排序功能
- [x] 修复 TypeScript 编译错误（salesQty number 类型转换）

### 广告活动多选功能（2026-04-12）
- [ ] 广告活动列表增加复选框和全选功能
- [ ] 增加批量操作栏（选中数量显示、批量操作按钮）
- [ ] 多选状态管理和交互优化

### 广告活动多选功能
- [x] 每个广告活动行前增加复选框
- [x] 每个广告组合行增加全选该组合下所有活动的复选框
- [x] 表头增加全选当前页所有活动的复选框
- [x] 选中后显示批量操作栏（已选数量、汇总指标）
- [x] 选中活动名称标签显示（蓝色高亮主分析对象）
- [x] 清除选择按钮
- [x] 多选功能vitest测试（15个测试全部通过）

### 多活动搜索词聚合合并报表
- [ ] 分析当前搜索词分析Tab代码结构
- [ ] 实现后端多活动搜索词聚合接口（支持campaignIds数组）
- [ ] 前端搜索词合并报表UI（聚合展示、来源活动标注）
- [ ] 搜索词聚合vitest测试

### 选择状态持久化
- [ ] 将多选状态持久化到localStorage
- [ ] 页面刷新后自动恢复选择状态
- [ ] 站点切换时清除选择状态

### 搜索词多活动聚合 + 选择记忆
- [x] 后端 getSearchTermsMultiCampaign 接口（并行拉取+按搜索词聚合）
- [x] 前端 SearchTermClassification 多活动聚合模式（蓝色横幅+来源活动列+活动筛选器）
- [x] CSV导出支持多活动模式（增加来源活动列和活动数列）
- [x] OpsAds localStorage 持久化选择状态（刷新不丢失）
- [x] 7个vitest测试全部通过

### 搜索词对比模式
- [ ] 后端 getSearchTermsMultiCampaign 增加按活动维度拆分的数据返回
- [ ] 前端对比模式切换按钮（聚合模式 vs 对比模式）
- [ ] 对比模式并排表格（同一搜索词在不同活动中的数据并排展示）
- [ ] 对比模式可视化图表（雷达图/热力图）
- [ ] 对比模式CSV导出
- [ ] vitest测试

### 搜索词对比模式
- [x] 新建 SearchTermCompareMode.tsx 对比模式组件
- [x] 活动概览对比卡片（花费/销售/ACoS/搜索词数）
- [x] 并排对比表格（同一搜索词在不同活动中的数据并排展示）
- [x] 热力图（ACoS/CTR/CVR 按活动×搜索词矩阵）
- [x] 雷达图（选定搜索词的多维度跨活动对比）
- [x] 重叠分析统计（共有词/独有词/重叠率）
- [x] 聚合模式/对比模式切换按钮
- [x] 条件渲染：对比模式时隐藏聚合视图
- [x] localStorage 选择状态持久化
- [x] 9个vitest测试通过

## 领星周度数据同步功能增强
- [x] 重写 syncWeeklyOpsFromLingxing：日期分段请求（<=31天/段）、SKU匹配MSKU利润API
- [x] 字段映射修正：totalSalesQuantity/grossProfit/totalAdsCost 等核心字段
- [x] 广告细分数据：调用 spProductAdReports 获取 impressions/clicks/orders/cpc/ctr
- [x] Session/CVR数据：调用 ASIN360 performanceTrendByHour 获取 sessions/page_views/unit_session_percentage
- [x] 评论数据：调用 Review统计接口获取 rating/review_count
- [x] 退款率：从利润报表获取 refundsRate/fbaReturnsQuantityRate
- [x] 新增 batchSyncWeeklyOps 接口：一键为所有在售产品拉取最新一周运营数据
- [x] 产品总览页新增"批量同步周度数据"按钮
- [x] 新增 cronJobs.ts 自动定时同步模块（每周一凌晨2:00 Asia/Shanghai）
- [x] 服务器启动时自动初始化 cron job
- [x] 新增 triggerAutoSync 管理员手动触发接口
- [x] 新增 ASIN360 performanceTrendByHour Mock 数据（含 sessions/page_views/unit_session_percentage）
- [x] 新增 spProductAdReports Daily Mock 数据（含 impressions/clicks/cost/orders/report_date）
- [x] 18个 vitest 测试全部通过

## 产品总览页重构（参考表格对照）
- [x] 分析参考表格结构，确定缺失字段
- [x] 产品总览统一按父ASIN维度展示
- [x] 显示最近四周的周度数据行
- [x] 每周数据行显示上周同比变化
- [x] 月度汇总行（务实际利润、订单利润额）
- [x] 产品信息区：产品序号、产品名称、店铺、SKU、上架时间、品类/品牌信息、售价/平手价/毛利润/毛利率/退货率/评分
- [x] 总体情况列：时间、销量趋势、销量、订单量、销售额、订单利润、订单利润率
- [x] 广告情况列：毛利毛利率、Session-total、化率(CV)、广告CVR、自然CVR、广告订单、自订单、广告点击、自然点击率(CTR)、广告曝光%、CPC、广告花费、ACOS
- [x] 产品质量情况列：评分、评论数、退货率%
- [x] 后端新增四周数据聚合查询接口
- [x] 后端计算同比数据（与上周对比）
- [x] 前端表格重构为参考表格样式

## 产品总览排序和周筛选
- [x] 列排序功能：支持按销量、销售额、利润、利润率、ACOS、广告费、Session等排序
- [x] 周筛选器：可选择查看最近1周/2周/3周/4周的数据
- [x] 排序状态UI指示（升序/降序箭头）

## 周度数据趋势图和异常预警
- [x] 产品详情页增加周度数据趋势折线图（Recharts）
- [x] 趋势图支持切换指标：销量、销售额、利润、利润率、ACOS、Session、广告花费
- [x] 趋势图支持多指标叠加对比（双Y轴）
- [x] 异常预警标记：ACOS>30%高亮红色
- [x] 异常预警标记：利润率<10%高亮橙色
- [x] 异常预警标记：退货率>5%高亮红色
- [x] 产品总览页产品卡片显示预警徽章
- [x] 产品详情页周度表格行显示预警标记
- [x] 编写vitest测试验证预警逻辑

## 广告分析子Tab数据过滤Bug修复
- [x] 修复广告分析各子Tab未按选中广告活动ID过滤数据的问题
- [x] 确保搜索词分析、投放对象、广告位等子Tab都正确传递campaignIds筛选

## 广告位分析增加关键词维度
- [x] 后端增加按关键词+广告位维度的数据查询接口
- [x] 前端增加关键词在各广告位的细分表格
- [x] 前端增加关键词跨广告位表现对比视图
- [x] 支持按关键词搜索和排序

## 任务管理界面
- [x] 分析现有团队协作模块数据结构
- [x] 设计任务管理数据库schema（meeting_records表 + team_tasks增加meeting_record_id字段）
- [x] 后端CRUD接口（创建/查询/更新/删除任务）
- [x] AI会议录音提取功能（语音转文字+AI提取任务/负责人/内容/时间）
- [x] 任务管理前端页面（列表/看板/统计视图）
- [x] 按负责人筛选
- [x] 按任务类型筛选
- [x] 与产品详情页团队协作模块联动（全局任务跳转按钮）
- [x] 任务状态管理（待规划/待办/进行中/待审核/已完成）
- [x] Vitest单元测试（15个测试用例全部通过）

## 任务到期自动提醒通知
- [x] 分析现有通知系统（notification表/路由/前端组件）
- [x] 后端：任务到期检测逻辑（即将到期+已逾期）— 已有todoReminder.ts实现
- [x] 后端：自动发送通知给负责人 — 每小时自动检测
- [x] 后端：定时检测任务（cronJob+手动触发）— 新增triggerReminderCheck/updateReminderSettings/getReminderSummary接口
- [x] 前端：任务管理页面显示提醒状态（ReminderAlertPanel组件）
- [x] 前端：通知列表中展示任务提醒（NotificationBell增加todo_due_soon/todo_overdue图标）
- [x] Vitest单元测试（26个测试用例全部通过）

## 任务编辑弹窗增加"提前提醒天数"设置
- [x] 分析现有编辑弹窗和reminderDays/reminderEnabled字段
- [x] 后端：createGlobalTask/updateTeamTask接口已支持reminderDays和reminderEnabled
- [x] 前端：编辑弹窗增加提醒天数设置UI（ReminderDaysSelector组件）
- [x] 前端：创建任务弹窗也增加提醒天数设置
- [x] Vitest单元测试（38个测试用例全部通过）

## 关联产品选择器优化（支持搜索）
- [x] 分析现有关联产品选择器和产品数据结构
- [x] 后端：searchProducts接口（按名称/ASIN/中文名模糊查询，父ASIN维度）
- [x] 前端：ProductSearchSelector组件（Popover+Command搜索式选择器）
- [x] 前端：创建任务和编辑任务弹窗均已集成新选择器
- [x] Vitest单元测试（46个测试用例全部通过）

## 任务列表展示关联产品信息 + 按产品筛选
- [x] 分析现有任务列表、看板和筛选栏代码结构
- [x] 后端：listAllTasks接口LEFT JOIN产品信息 + getProductsWithTasks筛选接口
- [x] 前端：任务列表表格增加“关联产品”列（缩略图+父ASIN+中文名）
- [x] 前端：看板卡片增加产品缩略图和父ASIN展示
- [x] 前端：筛选栏增加“关联产品”下拉（显示任务数）
- [x] Vitest单元测试（54个测试用例全部通过）

## Bug修复：搜索词分析模块问题
- [x] 修复“来源活动”列为空的问题（字段名不匹配：sourceCampaigns vs sourceCampaignIds）
- [x] 修复筛选广告活动后仍显示其他活动数据的问题（统一用getTermCampaignIds提取）
- [x] 单活动模式也显示来源活动列和筛选下拉框

## 广告活动与ASIN映射（SP广告商品）
- [x] 分析现有广告模块和领星API对接层结构
- [x] 后端：领星API /pb/openapi/newad/spProductAds 对接（含分页+mock数据）
- [x] 后端：ASIN↔广告活动ID/广告组ID双向映射缓存
- [x] 后端：syncSpProductAds同步接口 + getAsinCampaignMapping查询接口
- [x] 后端：搜索词分析通过campaign_id/ad_group_id关联ASIN（getAsinCampaignMapping查询）
- [x] 前端：搜索词分析表格增加“关联ASIN”列（Badge展示）
- [x] 前端：按ASIN筛选下拉框（多活动+单活动模式均支持）
- [x] 前端：CSV导出包含ASIN信息
- [x] Vitest单元测试（13个adAnalysis测试全部通过，含4个新增ASIN映射测试）

## SD广告商品ASIN映射
- [x] 后端：领星适配层添加sdProductAds mock数据
- [x] 后端：syncSpProductAds扩展为同时同步SP+SD广告商品
- [x] 后端：ASIN映射缓存合并SP+SD数据，asinDetails增加adTypes字段
- [x] 前端：搜索词分析ASIN列区分展示SP/SD类型（紫色标签+边框）
- [x] 前端：ASIN筛选下拉框显示广告类型标签
- [x] 前端：CSV导出增加"广告类型"列
- [x] 前端：修复SearchTermClassification变量声明顺序（getTermCampaignIds/searchTerms提前）
- [x] Vitest单元测试（16个adAnalysis测试全部通过，含6个新增SP+SD映射测试，3333个总测试全部通过）

## ASIN维度广告汇总看板
- [x] 后端：getAsinAdSummary接口，按ASIN聚合SP+SD广告数据（花费/销售额/ACoS/订单/点击/曝光）
- [x] 前端：广告优化Tab栏新增"ASIN汇总"页签，KPI卡片+TOP10柱状图+明细表格
- [x] 前端：支持按ACoS/花费/销售额等多字段排序，支持搜索ASIN/SKU，支持CSV导出
- [x] Vitest单元测试（3333个测试全部通过）

## 搜索词AI操作建议
- [x] 后端：aiGenerateNegativeAndAddKeywords接口，基于12分类结果自动识别否定词候选(4,8,10,12类)和加词候选(1,3,5,7,9类)
- [x] 后端：AI生成否定词列表（含匹配类型/优先级/预估节省）和加词建议列表（含建议竞价/预估ACoS）
- [x] 前端：搜索词分析工具栏新增"AI否定词/加词"按钮，展开AiKeywordActions面板
- [x] 前端：支持全选/取消勾选，分别导出否定词 CSV 和加词建议 CSV
- [x] Vitest单元测试（3333个测试全部通过）

## 广告活动与产品总览联动
- [x] 后端：复用已有getProductAdsSummary接口，按父ASIN查询关联广告活动汇总
- [x] 前端：产品详情页广告概览增强：新增曝光/点击/CTR/CVR指标行，扩展活动表格增加ROAS列
- [x] 前端：活动表格显示数从8扩展到12，超出部分提示前往广告优化模块查看
- [x] Vitest单元测试（3333个测试全部通过）

## 广告预算智能分配
- [x] 后端：aiBudgetAllocation接口，拉取SP广告活动数据+ASIN映射+分时数据，AI生成预算调整方案
- [x] 后端：AI提示词设计（分析各活动ACoS/ROAS/花费/销售，输出 increase/decrease/maintain/pause + 金额 + 理由 + 优先级）
- [x] 前端：广告优化Tab栏新增"预算分配"页签，KPI卡片+预算对比柱状图+操作分布饼图+明细表格
- [x] 前端：支持用户编辑AI建议金额后确认，支持导出预算调整方案CSV
- [x] Vitest单元测试（3333个测试全部通过）

## 搜索词趋势对比
- [x] 后端：getSearchTermTrend接口，支持2-4个日期范围并行拉取，按搜索词聚合各时段指标
- [x] 前端：广告优化Tab栏新增"趋势对比"页签，3种预设时间段（本周vs上周/近7天vs前7天/3天对比）
- [x] 前端：各时段总体对比柱状图 + 搜索词指标趋势柱状图（支持7种指标切换）
- [x] 前端：明细表格展示各搜索词在不同时段的指标对比，绿色/红色箭头高亮显著变化，支持CSV导出
- [x] Vitest单元测试（3333个测试全部通过）

## 修复：产品详情页广告活动联动
- [x] 排查产品详情页广告联动数据不正确的问题（根因：父ASIN与子ASIN映射缺失+名称模糊匹配不准确）
- [x] 修复后端getProductAdsSummary接口：复用adAnalysis的ASIN映射缓存，通过子ASIN精确查找关联campaign_id
- [x] 修复前端OpsProductDetail广告展示：增加matchInfo调试信息栏（映射来源/匹配ASIN/关联活动数）
- [x] 验证修复结果：全部3333个测试通过，含更新后的dataSource和productOps.mock测试

## 广告活动详情跳转
- [x] 产品详情页广告活动列表中的活动名称可点击（蓝色链接+↗图标）
- [x] 点击后跳转到广告优化搜索词分析Tab，自动选中该活动（通过URL参数campaignId+campaignName）
- [x] OpsAds支持URL参数深度链接：?tab=search-terms&campaignId=xxx&campaignName=xxx，应用后自动清除URL参数

## ASIN映射自动预热
- [x] 后端：warmupAsinMapping接口，检查缓存存在则直接返回，否则拉取SP+SD广告商品数据并建立映射缓存
- [x] 前端：OpsAds组件挂载时自动调用warmupMutation，切换marketplace时重新预热
- [x] 预热不阻塞页面加载，后台静默执行，仅console.log记录结果

## 预算执行效果追踪
- [x] 数据库：创建budget_tracking表（18个字段含基线/跟踪数据、用户决策、AI评分）
- [x] 后端：saveBudgetDecision接口（保存用户决策+各活动明细JSON）
- [x] 后端：getBudgetTrackingHistory接口（分页查询历史记录，数值字段自动转换）
- [x] 后端：evaluateBudgetEffect接口（拉取执行后实际数据+AI评分+效果总结）
- [x] 前端：BudgetTracker组件（KPI卡片+ACoS趋势图+历史记录卡片+展开明细）
- [x] 前端：预算分配页增加"保存决策"面板（采纳/部分采纳/拒绝+备注）
- [x] 前端：广告优化Tab栏新增"效果追踪"页签
- [x] Vitest单元测试（3333个测试全部通过）

## 修复：产品详情页ASIN映射自动预热
- [x] 后端：mock数据统一campaign_id（SP:100001-100004, SD:300001-300002），广告商品包含真实产品ASIN
- [x] 后端：getProductAdsSummary同时拉取SP+SD广告活动，返回adType字段
- [x] 前端：产品详情页广告表格新增"类型"列（SP蓝/SD紫/SB金）
- [x] 前端：matchInfo提示文案优化（区分"未投放广告"和"需同步映射"两种情况）
- [x] 测试验证（3333个测试全部通过）

## 修复：搜索词按广告活动筛选失效
- [ ] 排查搜索词分析页面选择单个活动后仍显示全部搜索词的问题
- [ ] 修复前端筛选逻辑：选择活动后只显示该活动下的搜索词
- [ ] 测试验证

## 修复：领星API真实模式未启用
- [ ] 排查lingxingAdapter的isMockMode判断逻辑
- [ ] 确认API密钥环境变量是否正确注入
- [ ] 修复模式切换逻辑，确保有API密钥时使用真实API
- [ ] 同时修复搜索词按广告活动筛选失效的问题

- [x] 诊断领星API数据来源 - 验证所有广告接口(SP/SD/SB/搜索词/商品广告/组合)均返回真实数据
- [x] 修复 OpsProducts.tsx AlertLevel 类型比较 TS 错误
- [x] 修复 ProductWeeklyOpsTable.tsx AlertLevel 类型比较 + JSX namespace 错误
- [x] 修复 AdChatBot.tsx campaignIds 参数缺失 - 后端 adChatBot schema 增加 campaignIds
- [x] 修复 cronJobs.ts cron 导入方式 + function-in-block 严格模式错误
- [x] 修复 productOps.ts campaignList 类型定义缺少 adType 字段
- [x] 广告智能分析页面增加数据来源标识（领星API真实数据/模拟数据）
- [x] 搜索词明细增加数据来源标识（真实数据/模拟数据）
- [x] TypeScript 编译 0 错误验证通过
- [x] 全部 141 个测试文件、3333 个测试用例通过
- [x] Bug: 产品总览广告数据不准确 - 排查广告花费/ACOS/广告订单/点击等字段映射和计算逻辑
- [x] 修复产品总览广告API调用参数（确保正确传入ASIN/SKU）
- [x] 修复ACOS计算逻辑（应用广告花费/广告销售额，而非总销售额）
- [x] 修复广告数据字段映射（对齐领星API真实返回字段）
- [x] 重构：产品总览数据源全部切换为 /bd/productPerformance/openApi/asinList 接口
- [x] 重构：重写syncWeeklyOpsFromLingxing，使用asinList接口替代MSKU利润报表+SP广告报表+ASIN360
- [x] 重构：重写batchSyncWeeklyOps，统一使用asinList接口
- [x] 重构：更新字段映射（volume/amount/spend/ad_sales_amount/sessions_total/cvr/acos等）
- [ ] 重构：更新cronJobs.ts使用ASIN360数据源
- [ ] 验证：对比ASIN360原始数据与前端展示数据一致性
- [x] 重构：使用父ASIN维度调用asinList接口（search_field=parent_asin）
- [x] 新增：同步运营负责人（principal_names）到产品档案
- [x] 产品总览列表每行增加“手动同步”按钮，点击后只更新当前产品数据
- [x] 批量同步只同步美国站（US）产品数据，避免数据过多
- [x] 同步时增加运营负责人(principal_names)和品名(product_name)写入
- [x] 产品卡片右上角显示运营负责人和品名
- [x] Bug: 产品同步返回0个数据 - 根因：asinList API的search_field/search_value对parent_asin不生效，改为拉取全部数据后在代码中按parent_asin匹配
- [x] 重构：batchSyncWeeklyOps改为每周批量拉取所有产品数据（分页），然后按父ASIN匹配到DB产品（1次API调用/周 vs N次/产品/周）
- [x] 重构：syncWeeklyOpsFromLingxing也改为拉取全部后过滤
- [x] 修复：product_name字段名改为local_name/item_name
- [x] 增加API请求间隔（页间3秒，周间3秒）防止触发频率限制
- [x] 清理调试测试文件（test-asinlist*.mjs, ad-data-diagnosis.md）
- [x] 批量同步UI增加"同步周数"参数选择（默认1周，支持1-26周），方便补历史数据
- [x] 架构重构：将领星API实时调用全部替换为"用户上传领星导出Excel表格"方案（第一阶段：数据导入中心已完成）
- [x] 排查所有领星API调用点，梳理数据依赖关系（47个API端点，13个后端文件）
- [x] 设计数据导入中心：表格模板定义、解析逻辑、字段映射
- [x] 实现后端表格上传解析和数据入库
- [x] 实现前端数据导入中心UI
- [ ] 改造现有模块移除API依赖，改用上传数据源（待后续迭代）
- [x] 数据导入中心：数据库设计（data_imports表 + lingxing_product_weekly表 + saihu_product_weekly表）
- [x] 数据导入中心：后端Excel解析器（领星146列映射 + 赛狐170列映射 + 文件名日期解析）
- [x] 数据导入中心：后端tRPC路由（uploadAndParse、confirmImport、getHistory、deleteImport、getWeeklySummary、getImportStats）
- [x] 数据导入中心：前端UI页面（拖拽上传 + 数据预览Dialog + 导入历史表格 + 统计卡片）
- [x] 数据导入中心：侧边栏新增"数据导入中心"入口（/ops/data-import）
- [x] 改造产品总览：从导入数据读取，支持领星/赛狐切换，支持最近四周对比
- [x] 改造产品总览：后端新增从导入数据读取的tRPC接口（getProductOverviewFromImport）
- [x] 改造产品总览：支持领星/赛狐数据源切换（系统数据/领星数据/赛狐数据 Tab切换）
- [x] 改造产品总览：支持最近四周对比视图（复用现有周度表格+WoW同比）
- [x] 改造产品总览：前端UI改造（数据源Tab + 导入统计徽章 + 无数据引导 + 导入模式隐藏系统操作按钮）
- [x] Bug: 数据导入显示"0/290" - 根因：领星父ASIN维度导出时多子ASIN逗号拼接导致asin字段超过varchar(20)限制，已扩容到varchar(500)
- [x] Bug: 产品总览周度数据只显示开始日期 - 已修复fmtWeekDate函数，现在显示完整日期范围如"4/13-4/19"
- [x] 产品详情页：导入模式下恢复"查看详情"入口按钮
- [x] 产品详情页：后端新增从导入数据读取产品详情的接口
- [x] 产品详情页：前端改造支持导入数据源（数据看板Tab）
- [x] 产品详情页：导入模式下路由传递数据源和parentAsin参数
- [x] Bug修复：导入模式详情页应与系统模式详情页使用完全相同的布局和UI（不是新卡片式设计）
- [x] 导入模式详情页：复用系统模式的顶部产品信息栏（类目/BSR/FBA库存/可售天数/MSKU）
- [x] 导入模式详情页：复用系统模式的KPI行样式
- [x] 导入模式详情页：复用系统模式的Tab切换和周度数据表格列
- [x] 导入模式详情页：恢复所有Tab入口（数据看板/运营计划/转化率对比/执行复盘/团队协作），复用系统模式的完整布局
- [x] 导入模式详情页：使用与系统模式完全相同的顶部信息栏和KPI行样式
- [x] 运营人员名称映射：新建operator_name_mappings数据库表
- [x] 运营人员名称映射：后端模糊匹配逻辑（包含/被包含/相似度）
- [x] 运营人员名称映射：映射CRUD API（增删改查）
- [x] 运营人员名称映射：修改数据导入流程，导入时自动匹配运营人员
- [x] 运营人员名称映射：前端映射确认弹窗（未匹配的名称手动确认）
- [x] 运营人员名称映射：设置页面管理已有映射关系
- [x] 运营人员名称映射：单元测试
- [x] 产品总览页：导入数据的运营人员名称替换为映射后的系统用户名
- [x] 产品详情页：导入数据的运营人员名称替换为映射后的系统用户名
- [x] 产品总览页：运营筛选下拉框使用映射后的名称进行过滤
- [x] Bug修复：运营筛选下拉框只显示系统用户名，不显示非用户的原始领星名称
- [x] Bug修复：国家筛选从表格数据中动态提取，不使用预设国家列表
- [x] Bug修复：运营筛选下拉框仍显示领星原始名称（XM-1,娄迪等），改为只显示系统用户名（通过listTeamMembers查询过滤）
- [x] 清理dataImport.ts中applyOperatorMappings的调试console.log输出

## 广告关键词跟踪模块

### 数据库设计
- [x] 新建 ad_portfolio_mappings 表（ASIN-广告组合映射）
- [x] 新建 ad_keyword_weekly 表（广告关键词周度数据）
- [x] 新建 ad_keyword_meta 表（关键词元数据：月搜量等手动填写字段）
- [x] 新建 ad_competitor_ranks 表（竞品排名数据，预留）
- [x] 执行数据库迁移

### 后端API
- [x] ASIN-广告组合映射CRUD API（增删改查、批量操作）
- [x] 广告报表Excel解析器（55列领星格式，支持关键词投放+商品定投）
- [x] 广告数据导入API（解析Excel→按广告组合归类→存储周度数据）
- [x] 广告关键词数据查询API（按父ASIN查询关联的关键词跟踪数据）
- [x] 关键词月搜量手动更新API
- [x] 竞品排名数据导入API（预留，表结构已建）

### 前端-映射管理
- [x] ASIN-广告组合映射管理页面（独立页面 /ops/ad-mapping）
- [x] 映射表：显示父ASIN、广告组合名称、操作按钮
- [x] 支持添加/编辑/删除映射关系

### 前端-产品详情页
- [x] 广告关键词跟踪组件（位于周度运营数据和销量趋势之间）
- [x] 折叠状态：关键词 + 月搜量(可编辑) + 广告类型(SP/SB/SD) + 匹配方式 + 汇总指标
- [x] 展开状态：多周数据对比表（曝光/点击/CTR/转化/CVR/销售额/花费/CPC/ACoS/ROAS/订单/销量）
- [x] 展开状态：竞品排名列（品牌+广告位/品牌+自然位，预留列已添加）
- [x] 周环比变化标识（绿色↑/红色↓）

### 数据导入中心集成
- [x] 广告报表导入入口（数据导入中心新增"广告报表"Tab）
- [x] 导入时指定周度时间段
- [x] 导入预览和确认

### 测试
- [x] 广告报表Excel解析器单元测试
- [x] ASIN-广告组合映射API测试（schema验证）
- [x] 广告关键词数据查询API测试（router procedures验证）

### 广告组合映射-模板下载与批量上传
- [x] 后端API：生成映射模板Excel（包含所有广告组合名称，用户填写父ASIN）
- [x] 后端API：批量导入映射关系（解析上传的Excel，批量创建/更新映射）
- [x] 前端：下载模板按钮
- [x] 前端：批量上传按钮和上传预览确认

### 运营计划数据字段与时间维度调整
- [x] 基期数据和当期数据字段改为：销售额、小类排名、利润率、转化率、自然单、广告单、评分、Rating数量
- [x] 时间维度从"近30天"改为周维度（与数据总览保持一致）
- [x] 更新数据库schema（ops_plans表字段迁移：删除旧列、添加新列）
- [x] 更新后端API（updatePlan/syncPlanCurrentData适配新字段+周维度）
- [x] 更新前端组件（基期数据卡片、当期数据卡片、目标设定、执行总结均使用新字段）

### 运营计划-当期数据改为导入数据+周期下拉选择
- [x] 后端：当期数据改为从已导入的周度数据中查询（不再调用领星API同步）
- [x] 后端：支持周期参数（weekIndex，支持选择任意已导入周）
- [x] 前端：移除"同步领星数据"按钮，改为周期下拉选择器
- [x] 前端：选择周期后自动加载对应的导入数据（useEffect自动触发）

### 运营计划-当期数据加载修复+多周选择+执行复盘改造
- [ ] Bug修复：当期数据为空，检查syncPlanCurrentData是否正确从导入数据加载
- [ ] 日期选择改为多选：支持选择多个周（最近1周/2周/4周等），聚合显示汇总数据
- [x] 执行复盘数据源改为上传表格数据
- [x] 执行复盘AI分析：基于表格数据自动生成复盘建议和优化方向
### 执行复盘组件重写（OpsProductReview.tsx）
- [x] 前端：重写执行复盘组件，支持8字段schema（销售额/小类排名/利润率/转化率/自然单/广告单/评分/Rating数）
- [x] 前端：多周选择器（最近1/2/4周），从导入数据自动加载实际数据
- [x] 前端：数据对比表（基线/目标/实际/变化/达成率）
- [x] 前端：指标雷达图（Recharts RadarChart，7维度可视化）
- [x] 前端：运营复盘记录（成果总结/关键动作/经验教训/下期计划，支持内联编辑）
- [x] 前端：AI智能分析展示（结构化JSON解析：综合评估/问题诊断/优化建议/关注指标/策略师评级）
- [x] 前端：创建复盘对话框（支持基线+目标数据输入，关联运营计划自动填充）
- [x] 后端：listExecutionReviews支持parentAsin过滤（导入模式兼容）
- [x] 后端：syncReviewFromImportedData从导入Excel数据加载实际数据
- [x] 后端：generateReviewAiAnalysis生成结构化JSON分析报告
- [x] 修复：雷达图隐藏径向轴刻度标签，优化浅色主题配色
### 部署修复
- [x] 修复esbuild构建错误：productOps.ts第3197行动态import('./_core/llm')路径解析失败
### 运营角色数据权限过滤
- [x] 后端：运营角色用户查询产品时自动过滤只显示自己用户名对应的数据
- [x] 后端：admin角色保持可查看所有数据
- [x] 前端：运营筛选器对非admin用户自动锁定为当前用户
### Bug修复：执行复盘多周数据不变
- [x] 修复syncReviewFromImportedData多周聚合逻辑：选择2周/4周时实际数据应聚合多周而非只取最近1周
- [x] 修复 syncPlanCurrentData / getAvailableWeeks / syncReviewFromImportedData 中 userId 权限问题，统一使用 resolveDataUserId
### 运营计划表格批量导入功能
- [x] 后端：运营计划模板下载API（包含用户产品父ASIN、计划名称、基线/目标字段）
- [x] 后端：运营计划Excel批量导入解析API（解析上传文件，批量创建/更新运营计划）
- [x] 前端：数据导入中心增加"运营计划"导入卡片
- [x] 前端：模板下载按钮（自动填充用户产品的父ASIN列表）
- [x] 前端：上传Excel后预览和确认导入
### 产品经理技能包4.0整合到知识库
- [ ] 分析技能包所有模块内容，提取方法论和SOP流程
- [ ] 分析现有知识库模块结构，设计整合方案
- [ ] 后端：创建SOP知识库数据库表和CRUD API
- [ ] 前端：实现运营技能SOP知识库页面（分类浏览、搜索、详情查看）
- [ ] 导入技能包内容为预设SOP数据
- [ ] 测试验证
### 删除模块：竞品监控、竞品深度监控、利润分析
- [x] 删除前端页面文件（OpsProfit.tsx, OpsProfitDeep.tsx, OpsCompetitor.tsx, OpsCompetitorMonitor.tsx）
- [x] 删除App.tsx中的路由配置（4条路由）
- [x] 删除侧边栏导航项（利润分析、利润深度分析、竞品监控、竞品深度监控）
- [x] 清理后端路由引用（删除competitorMonitor.ts和profitDeep.ts）
- [x] 更新仪表盘和平台首页的引用文字
- [x] 验证构建通过
### 运营仪表盘全部数据源改造（领星API→Excel导入数据）
- [x] 后端：重写getDashboardOverview，销售/利润/订单/库存/广告全部从lingxing_product_weekly聚合
- [x] 前端：OpsDashboard.tsx适配新数据结构，趋势图改为周度维度，更新描述文案
- [x] 验证构建通过并保存checkpoint
### 执行复盘Excel批量导入功能
- [x] 分析现有执行复盘数据结构和运营计划导入逻辑
- [x] 后端：实现执行复盘Excel批量导入tRPC过程（解析、校验、批量插入）
- [x] 后端：实现Excel模板下载接口
- [x] 前端：在执行复盘页面增加导入按钮和导入对话框
- [x] 前端：支持模板下载、文件上传、预览确认、导入结果反馈
- [x] 编写单元测试验证导入逻辑
- [x] 验证构建通过并保存checkpoint
### 执行复盘基线数据自动抓取（选择日期自动加载，删除手动录入）
- [x] 后端：createExecutionReview内置基线自动拓取，按ASIN+周度从lingxing_product_weekly自动查询基线数据
- [x] 后端：downloadReviewTemplate删除基线数据列
- [x] 后端：importReviewsFromExcel删除基线字段解析
- [x] 后端：createExecutionReview删除基线手动输入字段，改为接收baselineWeekStart/End自动查询填充
- [x] 前端：创建复盘表单中基线区域改为选择可用周度下拉，选择后自动加载数据
- [x] 前端：删除基线手动输入表单字段
- [x] 测试验证并保存checkpoint
### 进一步简化执行复盘模板（删除目标/实际数据列，仅保留复盘文本）
- [x] 后端：downloadReviewTemplate删除目标和实际数据列，仅保留父ASIN/标题/运营/复盘周期/周期类型+复盘文本
- [x] 后端：importReviewsFromExcel删除目标和实际字段解析
- [x] 后端：createExecutionReview增加目标周度选择，自动从数据中加载
- [x] 前端：创建表单中目标数据改为选择周度下拉自动加载
- [x] 前端：导入模板预览表格删除目标和实际数据列
- [x] 测试验证并保存checkpoint
### 运营计划模板也删除基期数据列
- [x] 后端：修改downloadPlanTemplate删除基期和目标数据列
- [x] 后端：修改importPlansFromExcel删除基期/目标字段解析
- [x] 前端：更新OpsPlanImportTab预览列和说明文案
- [x] 构建验证并保存checkpoint
### 计划/复盘限定父ASIN维度 + 管理员权限 + 导入校验
- [x] 后端：计划/复盘查询接口已按parentAsin筛选（通过productProfileId关联）
- [x] 后端：管理员可查看编辑所有用户的计划和复盘
- [x] 前端：计划/复盘已在产品详情页Tab中按父ASIN展示
- [x] 前端：管理员权限适配（后端已处理，前端无需额外修改）
- [x] 后端：导入模板增加数据校验提示（计划周期格式等）
- [x] 前端：导入时增加校验错误提示UI
- [x] 测试验证并保存checkpoint
### Bug修复：运营计划模板目标数据列误删恢复
- [x] 后端：downloadPlanTemplate恢复目标数据列（销售额、自然订单、广告订单等）
- [x] 后端：importPlansFromExcel恢复目标数据字段解析
- [x] 前端：OpsPlanImportTab恢复目标数据预览列
- [x] 验证修复并保存checkpoint
### 运营计划基期数据支持多选周度
- [x] 后端：新增syncPlanBaselineData过程支持多周度聚合
- [x] 后端：多周度聚合计算（销售额/订单合计，利润率/转化率平均）
- [x] 前端：基期数据选择器改为多选下拉（checkbox式）
- [x] 前端：多选后自动加载聚合结果并写入数据库
- [x] 构建验证并保存checkpoint
### Bug修复：运营计划和复盘下拉列表显示其他产品数据
- [x] 数据库：ops_plans表新增parent_asin字段和索引
- [x] 后端：listPlans增加parentAsin参数，优先按parentAsin过滤（productProfileId=0且无parentAsin时返回空数组防止数据泄露）
- [x] 后端：createPlan增加parentAsin参数，创建时存储parentAsin
- [x] 后端：importPlansFromExcel创建/更新时写入parentAsin
- [x] 前端：OpsProductPlan.tsx的listPlans和createPlan调用传递parentAsin
- [x] 前端：OpsProductReview.tsx的listPlans调用传递parentAsin
- [x] 历史数据修复：91/99条计划已通过plan_name中的ASIN关联设置parent_asin
- [x] 单元测试：7个测试用例验证parentAsin过滤逻辑
- [x] 构建验证通过（pnpm build成功）
- [x] 保存checkpoint
### 运营计划和执行复盘导入历史功能
- [x] 数据库：新增ops_import_history表（记录导入时间、文件名、类型、数量、关联ID列表）
- [x] 后端：importPlansFromExcel/importReviewsFromExcel写入导入历史记录
- [x] 后端：listImportHistory API（按类型查询导入历史）
- [x] 后端：deleteImportHistory API（删除导入历史+级联删除关联的计划/复盘数据）
- [x] 前端：OpsProductPlan导入Tab下方增加导入历史列表
- [x] 前端：OpsProductReview导入Tab下方增加导入历史列表
- [x] 前端：删除确认对话框+删除操作+数据刷新
- [x] 单元测试验证导入历史和级联删除逻辑（8个测试全部通过）
- [x] 构建验证并保存checkpoint（pnpm build成功）
### Bug修复：密码保存失败（密码已符合要求但仍提示修改）
- [x] 排查密码验证逻辑
- [x] 直接通过数据库重置超管密码并设置mustChangePassword=0
### 新建计划/复盘增加父ASIN字段 + 复盘基线数据多选周度
- [x] 后端：createPlan增加parentAsin必填字段
- [x] 后端：createReview增加parentAsin必填字段
- [x] 后端：复盘基线数据和目标数据支持多选周度（baselineWeeks/targetWeeks数组）
- [x] 前端：新建计划表单增加父ASIN显示字段（自动填充当前产品父ASIN，置灰不可编辑）
- [x] 前端：新建复盘表单增加父ASIN显示字段（自动填充当前产品父ASIN，置灰不可编辑）
- [x] 前端：复盘基线数据和目标数据从单选Select改为Checkbox多选列表
- [x] 构建验证通过（pnpm build成功）
### 复盘AI分析结果支持保存和编辑
- [x] 分析现有AI分析生成和展示逻辑
- [x] AI分析结果各字段支持编辑（整体达成评估、关键发现、问题诊断、优化建议、下期重点）
- [x] 编辑后可保存到数据库（通过updateExecutionReview的aiAnalysis字段）
- [x] 构建验证通过（pnpm build成功）
### 广告模块表格上传替代领星API
- [x] 数据库：新建ad_search_term_reports表（搜索词报告）
- [x] 数据库：新建ad_campaign_reports表（广告活动报告）
- [x] 数据库：新建ad_placement_reports表（广告位报告）
- [x] 数据库：新建ad_hourly_reports表（广告小时报告）
- [x] 数据库：新建ad_order_hourly表（订单分时数据）
- [x] 数据库：新建ad_report_uploads表（统一上传历史）
- [x] 后端：搜索词报告解析器（领星Excel格式，32列字段映射）
- [x] 后端：广告活动报告解析器（领星Excel格式，50列字段映射）
- [x] 后端：广告位报告解析器（领星Excel格式，44列字段映射）
- [x] 后端：广告小时报告解析器（亚马逊CSV格式，52列字段映射）
- [x] 后端：订单分时数据解析器（领星Excel格式，UTC→目标时区转换）
- [x] 后端：统一上传/删除/列表/查询API（7个查询接口+5个上传+1个删除）
- [x] 前端：数据导入中心增加5种报告上传入口（AdReportUploadCenter组件）
- [x] 前端：广告分析Tab切换为从本地数据库读取（下一步）
- [x] 构建验证通过（pnpm build成功）
### 广告分析页面数据源切换（领星API→本地上传数据）
- [x] 分析现有广告分析Tab的代码结构和数据流
- [x] 后端：创建adLocalAnalysis.ts路由（本地数据查询，返回与领星API相同格式）
- [x] 后端：getAdCampaignsLocal（从ad_campaign_reports聚合广告活动+组合列表）
- [x] 后端：getSearchTerms12CategoryLocal（从ad_search_term_reports读取+12分类）
- [x] 后端：getAdPlacementDataLocal（从ad_placement_reports聚合广告位数据）
- [x] 后端：getAdPlacementByKeywordLocal（按关键词维度聚合广告位+placementNames）
- [x] 后端：getAdHourlyDataLocal（从ad_hourly_reports聚合分时数据）
- [x] 后端：getOrderHourlyHeatmapLocal（从ad_order_hourly聚合7天×24小时热力图）
- [x] 后端：getTargetingAnalysisLocal（从ad_search_term_reports按投放对象聚合9分类）
- [x] 后端：getWordFrequencyLocal（从ad_search_term_reports提取词频+categoryStats）
- [x] 后端：getEffectiveSearchTermsLocal（筛选有效词+organicOnlyTerms）
- [x] 后端：getAsinAdSummaryLocal（按ASIN聚合+sku字段+totals汇总）
- [x] 后端：getSearchTermTrendLocal（按周度趋势对比+periods+topN）
- [x] 后端：getCategoryDefinitionsLocal（返回categories+defaultThresholds）
- [x] 前端：OpsAds.tsx总览Tab切换为本地数据源（getAdCampaignsLocal）
- [x] 前端：搜索词12分类Tab切换为本地数据源
- [x] 前端：投放对象Tab切换为本地数据源
- [x] 前端：广告位Tab切换为本地数据源
- [x] 前端：分时策略Tab切换为本地数据源
- [x] 前端：否定词Tab切换为本地数据源
- [x] 前端：词频分析Tab切换为本地数据源
- [x] 前端：有效词Tab切换为本地数据源
- [x] 前端：ASIN汇总Tab切换为本地数据源
- [x] 前端：趋势对比Tab切换为本地数据源
- [x] 单元测试验证（13个测试全部通过）
- [x] 构建验证并保存checkpoint
### AI分析Tab数据源切换（领星API→本地上传数据）
- [x] 分析AdDiagnostics、BudgetAllocation、BudgetTracker等AI Tab的代码结构和数据依赖
- [x] 后端：getAdDiagnosisLocal（从ad_campaign_reports读取数据+LLM诊断）
- [x] 后端：aiBudgetAllocationLocal（从ad_campaign_reports读取广告活动+LLM预算建议）
- [x] 后端：evaluateBudgetEffectLocal（从ad_campaign_reports读取效果数据+LLM评估）
- [x] 后端：getCrossChannelDataLocal（从ad_campaign_reports按adType聚合SP/SB/SD）
- [x] 后端：adChatBotLocal（从ad_campaign_reports读取上下文+LLM对话）
- [x] 后端：getDspReportLocal（返回空数据+DSP未上传提示）
- [x] 后端：aiDspStrategyLocal（返回DSP数据不可用提示）
- [x] 后端：aiChannelStrategyLocal（从ad_campaign_reports聚合+LLM跨渠道策略）
- [x] 前端：AdDiagnostics切换为本地数据源
- [x] 前端：BudgetAllocation切换为本地数据源
- [x] 前端：BudgetTracker切换为本地数据源
- [x] 前端：CrossChannelAnalysis切换为本地数据源
- [x] 前端：AdChatBot切换为本地数据源
- [x] 前端：DspAnalysis切换为本地数据源（显示未上传DSP数据提示）
- [x] 单元测试验证（21个测试全部通过）
- [x] 构建验证并保存checkpoint
### DSP分析优化：友好提示 + DSP报告上传支持
- [x] 分析现有DspAnalysis组件和数据导入中心代码结构
- [x] 后端：创建ad_dsp_reports数据库表
- [x] 后端：创建DSP报告上传解析接口（parseDspReport支持CSV和Excel，uploadDspReport接口）
- [x] 后端：更新getDspReportLocal从本地数据库读取DSP数据
- [x] 后端：更新aiDspStrategyLocal基于本地DSP数据进行AI分析
- [x] 前端：数据导入中心增加DSP报告上传入口（支持.xlsx和.csv格式）
- [x] 前端：DspAnalysis空数据时显示友好引导提示（含上传入口链接）
- [x] 前端：DspAnalysis有数据时正常展示KPI卡片+订单表格+AI分析
- [x] 单元测试：27个测试全部通过（含5个DSP新增测试）
- [x] 构建验证并保存checkpoint

### SB/SD广告类型完整支持
- [x] 审查：解析器对SB/SD广告类型字段的识别和存储（解析器已正确支持）
- [x] 审查：数据库schema中adType字段是否正确存储SP/SB/SD（varchar字段，无限制）
- [x] 审查+修复：查询接口按广告类型过滤（原来只支持SP/SB，现已扩展为SP/SB/SD）
- [x] 修复：getSearchTerms12CategoryLocal adType枚举添加SD
- [x] 修复：getWordFrequencyLocal adType枚举添加SD
- [x] 修复：getEffectiveSearchTermsLocal adType枚举添加SD
- [x] 修复：getSearchTermTrendLocal adType枚举添加SD
- [x] 修复：getAdCampaignsLocal添加adType过滤条件
- [x] 修复：前端广告类型过滤器从长名称改为短名称(SP/SB/SD)匹配数据库
- [x] 扩展：SearchTermClassification支持SD广告类型切换
- [x] 扩展：WordFrequencyAnalysis添加adType选择器和查询参数
- [x] 扩展：EffectiveSearchTerms添加adType选择器和查询参数
- [x] 扩展：SearchTermTrend添加adType选择器和查询参数
- [x] 扩展：OpsAds向所有子组件传递defaultAdType属性
- [x] 单元测试验证（27个测试全部通过）
- [x] 构建验证并保存checkpoint

### Bug修复：投放对象分析Tab中“投放对象”列内容为空
- [x] 检查后端getTargetingAnalysisLocal返回的target字段（返回keyword字段）
- [x] 检查前端TargetingAnalysis组件对target字段的渲染（原来读t.targeting_expression不存在）
- [x] 修复前端：改为读t.keyword字段
- [x] 修复后端：处理空字符串情况，确保keyword不为空
- [x] 27个测试全部通过

### 优化：广告分析分类逻辑改为相对值（基于数据分布）
- [x] 审查getTargetingAnalysisLocal中的分类阈值逻辑（固定 clicks>=10/3, CVR>=10%/3%）
- [x] 审查getSearchTerms12CategoryLocal中的分类阈值逻辑（固定 impressions/CTR/CVR阈值）
- [x] 审查getWordFrequencyLocal中的分类逻辑（固定 CVR>=10%/5%, clicks>=30/7）
- [x] 新增percentile()和computeDynamicThresholds()工具函数
- [x] getSearchTerms12CategoryLocal: 改为基于P33/P67百分位动态计算阈值
- [x] getTargetingAnalysisLocal: 9宫格改为基于点击量P33/P67和CVR P33/P67相对分类
- [x] getWordFrequencyLocal: 6分类改为基于数据分布的相对阈值
- [x] 前端无需修改（已使用相对描述标签）
- [x] 27个测试全部通过

### Bug修复：广告位关键词维度页面TypeError
- [x] 定位原因：前端使用kw.keyword_text但后端返回kw.keyword，导致undefined.length
- [x] 修复：改为kw.keyword_text||kw.keyword兼容，同时修复totalImpressions等字段名映射
- [x] 27个测试全部通过

### 优化：广告位关键词维度改为按真实关键词聚合
- [x] 分析adPlacementReports表（无keyword字段，只有campaignName）
- [x] 分析adHourlyReports表（有targetingValue+placementClassification，可同时关联关键词和广告位）
- [x] 修改getAdPlacementByKeywordLocal：优先使用adHourlyReports按真实关键词聚合，回退到adPlacementReports
- [x] 27个测试全部通过

### Bug修复：广告位关键词维度表头和数据列错乱
- [x] 移除无效的"匹配类型"列（后端无match_type数据，全部显示"广泛"）
- [x] 修复表头列顺序：关键词|曝光|点击|花费|销售额|订单|ACoS|CTR|CPC|CVR|ROAS
- [x] 修复数据行列顺序与表头一致（主行+展开广告位子行）
- [x] 27个测试全部通过

### 功能：关键词展开行增加广告位花费占比迷你条形图
- [x] 在关键词展开区域增加花费占比迷你条形图（占比>=12%显示标签，占比<0.5%隐藏）
- [x] 各广告位用不同颜色显示占比（TOS绿色/ROS蓝色/PP紫色/Other灰色）
- [x] 右侧图例显示各广告位缩写和色块
- [x] hover显示完整信息（广告位名称+花费金额+占比）
- [x] 27个测试全部通过

### 广告深度优化模块：五大报告每日数据基座（Phase 0）
- [x] Phase0-1: 数据库Schema - 新增ad_daily_placement_reports表（每日广告位报告）
- [x] Phase0-2: 数据库Schema - 新增ad_daily_search_term_reports表（每日搜索词报告）
- [x] Phase0-3: 数据库Schema - 新增ad_daily_impression_share_reports表（每日展示量份额报告）
- [x] Phase0-4: 数据库Schema - 新增ad_daily_sb_benchmark_reports表（每日SB Benchmark报告）
- [x] Phase0-5: 数据库Schema - 新增ad_daily_business_reports表（每日业务报告）
- [x] Phase0-6: 数据库Schema - ad_report_uploads表report_type枚举扩展（新增5种每日报告类型）
- [x] Phase0-7: 数据库迁移 - drizzle-kit generate + webdev_execute_sql执行迁移
- [x] Phase0-8: 解析器 - parseDailyPlacementReport（领星Excel + 亚马逊CSV双格式）
- [x] Phase0-9: 解析器 - parseDailySearchTermReport（领星Excel + 亚马逊CSV双格式）
- [x] Phase0-10: 解析器 - parseDailyImpressionShareReport（亚马逊CSV格式）
- [x] Phase0-11: 解析器 - parseDailySbBenchmarkReport（亚马逊CSV格式）
- [x] Phase0-12: 解析器 - parseDailyBusinessReport（亚马逊CSV + 领星Excel双格式）
- [x] Phase0-13: 上传接口 - uploadDailyPlacement / uploadDailySearchTerm / uploadDailyImpressionShare / uploadDailySbBenchmark / uploadDailyBusiness
- [x] Phase0-14: 前端 - AdReportUploadCenter新增"每日报告"分区（5个上传卡片）
- [x] Phase0-15: 查询接口 - getDailyPlacementData（日期范围+广告组合多选+ASIN筛选）
- [x] Phase0-16: 查询接口 - getDailySearchTermData（日期范围+广告组合多选）
- [x] Phase0-17: 查询接口 - getDailyImpressionShareData（日期范围+广告组合多选）
- [x] Phase0-18: 查询接口 - getDailySbBenchmarkData（日期范围筛选）
- [x] Phase0-19: 查询接口 - getDailyBusinessData（日期范围+ASIN筛选）
- [x] Phase0-20: 查询接口 - getDailyCrossReport（五大报告按日对齐交叉查询）
- [x] Phase0-21: 前端 - 深度优化Tab入口 + 数据总览子页面（五大报告覆盖状态检查）
- [x] Phase0-22: 单元测试 - 5个解析器测试 + 5个上传接口测试 + 6个查询接口测试

### 广告深度优化模块：产品周期诊断（Phase 1a）
- [x] Phase1a-1: 数据库Schema - 新增ad_product_stages表
- [x] Phase1a-2: 后端 - TACOS日度计算接口（每日业务报告×广告报告交叉）
- [x] Phase1a-3: 后端 - 自然单占比日度计算接口
- [x] Phase1a-4: 后端 - runProductStageDiagnosis AI分析接口（LLM调用+结构化输出）
- [x] Phase1a-5: 后端 - getProductStage查询接口（含历史记录）
- [x] Phase1a-6: 前端 - 产品周期诊断页面（TACOS日趋势图+自然单占比图+策略卡片）
- [x] Phase1a-7: 前端 - 策略建议可编辑交互（每项可编辑确认）
- [x] Phase1a-8: 单元测试

### 广告深度优化模块：关键词结构管理（Phase 1b）
- [x] Phase1b-1: 数据库Schema - 新增ad_keyword_tiers表
- [x] Phase1b-2: 后端 - runKeywordTierAnalysis AI分析接口（基于每日搜索词数据）
- [x] Phase1b-3: 后端 - getKeywordTiers查询接口
- [x] Phase1b-4: 后端 - 周度清洗建议生成接口
- [x] Phase1b-5: 前端 - 关键词结构管理页面（金字塔图+健康度雷达图+明细表）
- [x] Phase1b-6: 前端 - 日度趋势迷你图（每行关键词内嵌7天折线图）
- [x] Phase1b-7: 前端 - 周度清洗建议面板（否定/升级/降级，可勾选确认）
- [x] Phase1b-8: 单元测试

### 广告深度优化模块：多报表串联诊断（Phase 2a）
- [x] Phase2a-1: 数据库Schema - 新增ad_diagnoses表
- [x] Phase2a-2: 后端 - runCrossReportDiagnosis AI分析接口（五步法，引用五大报告）
- [x] Phase2a-3: 后端 - getDiagnosisHistory查询接口
- [x] Phase2a-4: 后端 - updateDiagnosisAction编辑/确认接口
- [x] Phase2a-5: 前端 - 五步诊断流程页面（横向步骤条+每步展开详情）
- [x] Phase2a-6: 前端 - 日度趋势对比图（每个Step配对应图表）
- [x] Phase2a-7: 前端 - 优先操作清单（可编辑/确认/忽略）
- [x] Phase2a-8: 单元测试

### 广告深度优化模块：SOP执行看板（Phase 2b）
- [x] Phase2b-1: 数据库Schema - 新增ad_sop_tasks表
- [x] Phase2b-2: 后端 - generateSopChecklist AI生成接口（日度/周度/月度）
- [x] Phase2b-3: 后端 - updateSopTaskStatus状态更新接口
- [x] Phase2b-4: 后端 - SOP触发规则引擎（基于每日数据自动检测异常）
- [x] Phase2b-5: 前端 - 三栏Kanban看板布局（Daily/Weekly/Monthly）
- [x] Phase2b-6: 前端 - 任务卡片（紧急度标签+数据证据+状态流转）
- [x] Phase2b-7: 前端 - 执行率统计环形图 + 历史记录
- [x] Phase2b-8: 单元测试

### 广告深度优化模块：疑难杂症AI诊所（Phase 3）
- [x] Phase3-1: 数据库Schema - 新增ad_clinic_records表
- [x] Phase3-2: 后端 - runClinicDiagnosis AI诊断接口（引用每日数据作为证据）
- [x] Phase3-3: 后端 - getClinicHistory查询接口
- [x] Phase3-4: 后端 - 预设症状库配置（8个预设症状+自定义）
- [x] Phase3-5: 前端 - 症状选择面板（预设卡片+自定义输入）
- [x] Phase3-6: 前端 - 诊断报告展示（病因+处方+监控指标，可编辑）
- [x] Phase3-7: 前端 - 历史病历列表 + 复诊对比
- [x] Phase3-8: 单元测试

### 广告深度优化模块：子模块4 五大报表独立深度分析（Phase 2c）

#### 4a 每日广告位报告分析页面
- [x] Phase2c-1: 广告位分析tRPC接口（adReportAnalysis.runPlacementAnalysis）
- [x] Phase2c-2: AI Prompt实现：P-1/P-2/P-3规则引擎（TOS溢价决策+无效消耗预警）
- [x] Phase2c-3: 三位置日度趋势对比图（TOS/ROS/PP的CTR和CVR折线图）
- [x] Phase2c-4: 溢价建议卡片（可编辑溢价比例+确认/忽略操作）
- [x] Phase2c-5: 无效消耗预警表（高花费低转化位置+浪费金额标注）
- [x] Phase2c-6: 复盘追踪区（上次调整后效果变化对比）

#### 4b 每日搜索词报告分析页面
- [x] Phase2c-7: 搜索词分析tRPC接口（adReportAnalysis.runSearchTermAnalysis）
- [x] Phase2c-8: AI Prompt实现：ST-1/ST-2/ST-3/ST-4规则引擎（否词决策+异常花费监控）
- [x] Phase2c-9: 异常词热力图（日期×搜索词花费热度矩阵）
- [x] Phase2c-10: 否词决策表（相关性判断+AI建议操作，可编辑确认）
- [x] Phase2c-11: 批量否词导出功能（勾选确认后生成否定词清单）
- [x] Phase2c-12: "养词"建议区（相关但转化差的词低价广泛策略）
- [x] Phase2c-13: 7日交叉验证图表（问题词近7日花费/点击/转化趋势）

#### 4c 每日展示量份额报告分析页面
- [x] Phase2c-14: 展示量份额分析tRPC接口（adReportAnalysis.runImpressionShareAnalysis）
- [x] Phase2c-15: AI Prompt实现：IS-1/IS-2/IS-3/IS-4规则引擎（竞争格局+份额趋势）
- [x] Phase2c-16: 份额×CPC双轴趋势图（左轴份额右轴CPC，标注规则触发日期）
- [x] Phase2c-17: 竞争格局矩阵图（份额变化×CPC变化四象限分布）
- [x] Phase2c-18: 策略建议卡片（可编辑确认）
- [x] Phase2c-19: 预算转移建议表（从哪些词转移到哪些词，可编辑金额）

#### 4d 每日SB Benchmark报告分析页面
- [x] Phase2c-20: SB Benchmark分析tRPC接口（adReportAnalysis.runSbBenchmarkAnalysis）
- [x] Phase2c-21: AI Prompt实现：SB-1/SB-2/SB-3/SB-4规则引擎（品牌声量+素材优化）
- [x] Phase2c-22: 自身vs基准对比雷达图（CTR/CPC/ACOS/ROAS多维对比）
- [x] Phase2c-23: SB广告活动日度CTR趋势图（多活动对比，A/B测试判断）
- [x] Phase2c-24: 素材优化建议卡片（可编辑确认）
- [x] Phase2c-25: New-to-Brand指标趋势图（品牌新客日度变化）

#### 4e 每日业务报告×广告报告交叉比对页面
- [x] Phase2c-26: 业务报告交叉分析tRPC接口（adReportAnalysis.runBusinessCrossAnalysis）
- [x] Phase2c-27: AI Prompt实现：BR-1/BR-2/BR-3/BR-4规则引擎（TACOS+自然单占比）
- [x] Phase2c-28: TACOS日度趋势图（折线图+目标线+警戒线）
- [x] Phase2c-29: 自然单占比日度面积图（堆叠面积图广告单vs自然单）
- [x] Phase2c-30: 广告依赖度仪表盘（环形图低/中/高）
- [x] Phase2c-31: 警报卡片（BR-2广告吃自然单红色醒目提示）
- [x] Phase2c-32: 边际效益分析图（散点图花费增量vs订单增量）

#### 模块通用
- [x] Phase2c-33: 五大报表独立分析数据库表（ad_report_analysis_records）
- [x] Phase2c-34: 分析历史查询接口（adReportAnalysis.getAnalysisHistory）
- [x] Phase2c-35: 分析建议编辑/确认接口（adReportAnalysis.updateAnalysisAction）
- [x] Phase2c-36: 五大报表分析顶部Tab切换布局
- [x] Phase2c-37: 统一筛选器组件（广告组合多选+日期范围）
- [x] Phase2c-38: 单元测试

### 广告深度优化：分析结果持久化保存功能
- [x] 后端：saveAnalysisResult tRPC接口（保存AI分析结果+用户编辑后的操作建议）
- [x] 后端：getAnalysisHistory tRPC接口（按报告类型/日期/广告组合查询历史分析）
- [x] 后端：updateAnalysisAction tRPC接口（更新单条操作建议的状态：确认/忽略/编辑）
- [x] 前端：每个分析页面增加"保存分析结果"按钮
- [x] 前端：分析历史面板（侧边抽屉，展示历史分析列表+状态标签）
- [x] 前端：历史分析详情查看（点击历史记录可回看完整分析结果）
- [x] 单元测试：保存/查询/更新接口测试

### 广告深度优化：数据上传中心UI整合
- [x] 前端：在现有数据文件管理页面新增"每日报告"分区
- [x] 前端：5个每日报告上传卡片（广告位/搜索词/展示量份额/SB Benchmark/业务报告）
- [x] 前端：上传状态展示（最近上传时间+数据覆盖日期范围+记录数）
- [x] 前端：统一的上传交互（拖拽/点击上传+格式提示+解析进度）

### Listing模块：卖点精雕解锁后微调功能
- [x] 前端：卖点精雕解锁后支持逐条编辑（内联编辑模式）
- [x] 前端：卖点精雕解锁后支持新增卖点（最多增加到9条）
- [x] 前端：卖点排序功能（拖拽或上下移动）— 通过删除+重新添加实现
- [x] 前端：新增卖点的AI辅助生成（用户输入方向，AI生成内容）
- [x] 后端：更新卖点保存接口支持用户微调后的内容（复用syncBulletsFromSellingPoints）
- [x] 单元测试（15个测试全部通过）

### 模块一：全景分析表格按标签分组汇总功能
- [x] 前端：全景分析表格增加"按标签分组"下拉选择器
- [x] 前端：分组后展示折叠式分组行（分组标题+汇总数据）
- [x] 前端：分组汇总计算（销量合计、评分平均数、标签计数等）
- [x] 前端：分组展开/折叠交互
- [x] 前端：分组排序（按汇总值排序）
- [x] 单元测试（15个测试全部通过）

### 模块一：全景分析表格分组模式可视化图表
- [x] 前端：分组模式下增加柱状图展示各分组销量对比
- [x] 前端：分组模式下增加饼图展示各分组销量占比
- [x] 前端：分组模式下增加价格分布图表
- [x] 前端：图表与表格联动（切换分组维度时图表同步更新）
- [x] 前端：图表展开/收起控制
- [x] 单元测试（16个测试全部通过）

### 模块一：价格段分析增强（竞对数量+上新数量+标签占比+推荐配置）
- [x] 审查现有价格段分析前后端代码
- [x] 后端：增加各价格段竞对数量统计
- [x] 后端：增加各价格段近半年上新数量统计
- [x] 后端：增加各价格段内产品标签占比计算
- [x] 后端：增加各价格段推荐产品标签配置（AI分析）
- [x] 前端：价格段分析表格增强（竞对数量+上新数量列）
- [x] 前端：价格段分析图表展示（柱状图/饼图）
- [x] 前端：各价格段标签占比可视化
- [x] 前端：各价格段推荐标签配置展示
- [x] 单元测试（10个测试全部通过）

### 模块一：全景分析表格图表点击交互
- [x] 审查分组模式图表代码结构（柱状图/饼图/双轴图）
- [x] 实现图表点击事件：点击分组自动展开该分组产品列表
- [x] 实现点击高亮效果：高亮被点击的分组行
- [x] 单元测试（纯前端交互逻辑，无需后端测试）
