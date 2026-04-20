# asinList API Real Response Field Mapping

## Data Structure
- Response: `{ code, msg, data: { total, list: [...items], chain_start_date, chain_end_date } }`
- Items are in `data.list[]`, NOT directly in `data`

## Key Fields (from real response)

### Product Identity
- `parent_asins[0].parent_asin` - Parent ASIN (nested!)
- `item_name` - English product title
- `local_name` - Chinese product name (often null)
- `small_image_url` - Product image
- `principal_names` - Array of operator names, e.g. ["XM-2,赵寒"]
- `developer_names` - Array of developer names

### Sales
- `volume` - Total units sold (integer)
- `order_items` - Total order items (integer)
- `amount` - Total sales amount (string, CNY)
- `gross_profit` - Gross profit (string, CNY)
- `gross_margin` - Gross margin ratio (string, e.g. "0.2626")

### Advertising
- `spend` - Total ad spend (string, CNY)
- `ad_sales_amount` - Total ad sales (string, CNY)
- `acos` - ACOS ratio (string, e.g. "0.0884")
- `tacos` - TACOS ratio
- `roas` - ROAS
- `impressions` - Ad impressions (integer)
- `clicks` - Ad clicks (integer)
- `ctr` - Click-through rate (string)
- `cpc` - Cost per click (string, CNY)
- `ad_order_quantity` - Ad orders (integer)
- `ad_cvr` - Ad conversion rate (string)
- `ads_sp_cost` - SP ad cost (string, CNY)
- `shared_ads_sb_cost` - SB ad cost (string, CNY)
- `ads_sd_cost` - SD ad cost (string, CNY)

### Session & Conversion
- `sessions_total` - Total sessions (integer)
- `sessions` - Desktop sessions
- `sessions_mobile` - Mobile sessions
- `cvr` - Conversion rate (string, e.g. "0.0900")
- `page_views_total` - Total page views

### Inventory
- `afn_fulfillable_quantity` - FBA available quantity
- `available_days` - Available days of stock
- `month_stock_sales_ratio` - Monthly stock/sales ratio

### Reviews
- `avg_star` - Average star rating (string)
- `reviews_count` - Total reviews (integer)

### Returns
- `return_rate` - Return rate (string)
- `return_count` - Return count

### Ranking
- `cate_rank` - Category rank
- `rank_category` - Rank category name
- `small_cate_rank[].category` - Sub-category name
- `small_cate_rank[].rank` - Sub-category rank
