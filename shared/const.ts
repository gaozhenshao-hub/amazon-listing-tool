export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = '请先登录 (10001)';
export const NOT_ADMIN_ERR_MSG = '您没有足够的权限 (10002)';
export const ACCOUNT_DISABLED_MSG = '账号已被禁用，请联系管理员 (10003)';
export const ACCOUNT_LOCKED_MSG = '账号已被锁定，请稍后再试 (10004)';
export const INVALID_CREDENTIALS_MSG = '邮箱/手机号或密码错误 (10005)';
export const MUST_CHANGE_PASSWORD_MSG = '请修改初始密码 (10006)';

// Role definitions
export const ALL_ROLES = [
  'super_admin', 'admin', 'ops_manager', 'ops_specialist',
  'product_dev', 'finance', 'purchaser', 'designer'
] as const;

export const ROLE_LABELS: Record<string, string> = {
  super_admin: '超级管理员',
  admin: '公司管理员',
  ops_manager: '运营主管',
  ops_specialist: '运营专员',
  product_dev: '产品开发',
  finance: '财务',
  purchaser: '采购',
  designer: '美工',
};

export const ADMIN_ROLES = ['super_admin', 'admin'] as const;
export const MANAGER_ROLES = ['super_admin', 'admin', 'ops_manager'] as const;

// Module access by role
export const ROLE_MODULE_ACCESS: Record<string, string[]> = {
  super_admin:    ['dev', 'listing', 'ops', 'service', 'knowledge', 'admin', 'offsite', 'emperor'],
  admin:          ['dev', 'listing', 'ops', 'service', 'knowledge', 'admin', 'offsite', 'emperor'],
  ops_manager:    ['listing', 'knowledge', 'ops', 'offsite'],
  ops_specialist: ['listing', 'knowledge'],
  product_dev:    ['dev', 'knowledge'],
  finance:        ['dev'],
  purchaser:      ['dev'],
  designer:       ['listing', 'knowledge'],
};

// Operation-level permissions
export const PERMISSION_OPERATIONS = ['read', 'edit', 'delete'] as const;
export type PermissionOperation = typeof PERMISSION_OPERATIONS[number];

export const OPERATION_LABELS: Record<string, string> = {
  read: '只读',
  edit: '编辑',
  delete: '删除',
};

// Sub-module definitions (二级模块)
export const SUB_MODULES: Record<string, { id: string; label: string }[]> = {
  dev: [
    { id: 'dev_dashboard', label: '仪表盘' },
    { id: 'dev_new_project', label: '新建项目' },
    { id: 'dev_projects', label: '项目列表' },
    { id: 'dev_compare', label: '产品对比' },
    { id: 'dev_supplier', label: '供应商库' },
  ],
  listing: [
    { id: 'listing_projects', label: '项目管理' },
    { id: 'listing_analysis', label: '竞品分析' },
    { id: 'listing_comparison', label: '竞品对比' },
    { id: 'listing_review_history', label: '导入历史' },
    { id: 'listing_review_aggregation', label: '评论聚合分析' },
    { id: 'listing_keywords', label: '关键词管理' },
    { id: 'listing_ad_structure', label: '广告架构' },
    { id: 'listing_data_files', label: '数据文件' },
    { id: 'listing_generate', label: 'Listing生成' },
    { id: 'listing_preview', label: '结果预览' },
    { id: 'listing_score', label: 'Listing评分' },
    { id: 'listing_image_workflow', label: '智能图片建议' },
  ],
  ops: [
    { id: 'ops_dashboard', label: '运营仪表盘' },
    { id: 'ops_products', label: '产品总览' },
    { id: 'ops_profit', label: '利润分析' },
    { id: 'ops_inventory', label: '库存预警' },
    { id: 'ops_ads', label: '广告优化' },
    { id: 'ops_forecast', label: '销量预测' },
    { id: 'ops_data_import', label: '运营数据导入' },
    { id: 'ops_ad_mapping', label: '广告映射' },
    { id: 'ops_ad_deep', label: '广告深度分析' },
    { id: 'ops_tasks', label: '运营任务' },
    { id: 'ops_logistics', label: '物流管理' },
    { id: 'ops_crawler', label: '数据采集' },
    { id: 'ops_custom_dashboard', label: '自定义看板' },
  ],
  service: [
    { id: 'service_dashboard', label: '售后仪表盘' },
    { id: 'service_reply', label: 'AI客服回复' },
    { id: 'service_returns', label: '退货分析' },
    { id: 'service_templates', label: '邮件模板' },
    { id: 'service_profiles', label: '客户画像' },
  ],
  knowledge: [
    { id: 'kb_overview', label: '知识库总览' },
    { id: 'kb_bot', label: 'AI知识助手' },
    { id: 'kb_products', label: '智能产品创意库' },
    { id: 'kb_listings', label: '智能Listing文案库' },
    { id: 'kb_images', label: '智能图片知识库' },
    { id: 'kb_skills', label: '智能运营SOP库' },
    { id: 'kb_videos', label: '智能视频知识库' },
    { id: 'kb_intel', label: '情报推荐中心' },
  ],
  admin: [
    { id: 'admin_users', label: '用户管理' },
    { id: 'admin_review', label: '审核中心' },
    { id: 'admin_projects', label: '项目分配' },
    { id: 'admin_sop_access', label: 'SOP权限' },
    { id: 'admin_roles', label: '角色管理' },
    { id: 'admin_sync', label: '同步与监控' },
  ],
  offsite: [
    { id: 'offsite_overview', label: '站外总览' },
    { id: 'offsite_influencers', label: '达人管理' },
    { id: 'offsite_campaigns', label: '活动管理' },
    { id: 'offsite_outreach', label: '外联管理' },
    { id: 'offsite_content_review', label: '内容审核' },
    { id: 'offsite_social', label: '社媒账号' },
    { id: 'offsite_calendar', label: '内容日历' },
    { id: 'offsite_tiktok', label: 'TikTok矩阵' },
    { id: 'offsite_attribution', label: '归因追踪' },
    { id: 'offsite_analytics', label: '全渠道分析' },
  ],
  emperor: [
    { id: 'emperor_skills', label: 'Skill 库' },
    { id: 'emperor_trace', label: '运行历史' },
    { id: 'emperor_agents', label: 'Agent 编排' },
    { id: 'emperor_models', label: '模型路由' },
    { id: 'emperor_mcp', label: 'MCP 连接器' },
    { id: 'emperor_schedules', label: '定时任务' },
    { id: 'emperor_usage', label: 'Token 用量' },
    { id: 'emperor_diagnostics', label: '诊断中心' },
    { id: 'emperor_settings', label: '通用设置' },
    { id: 'emperor_knowledge', label: '知识库' },
    { id: 'emperor_observability', label: '可观测性' },
  ],
};

/**
 * 单公司权限目录唯一来源。角色编辑页、前台路由守卫和资源级授权均应从此目录派生，
 * 禁止再单独维护模块列表。
 */
export const PERMISSION_MODULES = [
  { id: 'dev', label: '智能产品开发', description: '仪表盘、项目管理、产品对比、供应商库' },
  { id: 'listing', label: '智能Listing生成', description: '竞品分析、关键词管理、广告架构、Listing生成、评分与图片工作流' },
  { id: 'ops', label: '智能运营提效', description: '产品总览、库存、广告、物流、数据导入与运营任务' },
  { id: 'service', label: '智能售后管理', description: '客户评价、退货分析、邮件模板与客户画像' },
  { id: 'knowledge', label: '智能知识库', description: '产品创意、Listing、图片、SOP、视频与情报中心' },
  { id: 'admin', label: '系统管理', description: '用户、审核、项目分配、SOP、角色与同步监控' },
  { id: 'offsite', label: '站外营销', description: '达人、活动、外联、内容、社媒与归因分析' },
  { id: 'emperor', label: '皇帝AI中台', description: 'Skill、Agent、模型、MCP、运行记录与诊断' },
] as const;

export const PERMISSION_MODULE_LABELS: Record<string, string> = Object.fromEntries(
  PERMISSION_MODULES.map((module) => [module.id, module.label]),
);

export type PermissionRouteRule = {
  moduleId: string;
  subModuleId?: string;
  /** catalog_only is a compatibility stage: displays and audits the directory without changing legacy route access. */
  enforcement: 'enforced' | 'catalog_only';
};

/**
 * Full UI route catalogue. Existing guarded routes remain enforced. Routes newly brought into
 * the catalogue use catalog_only until role templates are explicitly reviewed, preventing an
 * automatic change to current members' access during the directory-sync phase.
 */
export const PERMISSION_ROUTE_REGISTRY: Record<string, PermissionRouteRule> = {
  '/dev': { moduleId: 'dev', subModuleId: 'dev_dashboard', enforcement: 'enforced' },
  '/dev/new-project': { moduleId: 'dev', subModuleId: 'dev_new_project', enforcement: 'enforced' },
  '/dev/projects': { moduleId: 'dev', subModuleId: 'dev_projects', enforcement: 'enforced' },
  '/dev/project/:id': { moduleId: 'dev', subModuleId: 'dev_projects', enforcement: 'enforced' },
  '/dev/project/:id/analysis': { moduleId: 'dev', subModuleId: 'dev_projects', enforcement: 'enforced' },
  '/dev/project/:id/offsite': { moduleId: 'dev', subModuleId: 'dev_projects', enforcement: 'enforced' },
  '/dev/compare': { moduleId: 'dev', subModuleId: 'dev_compare', enforcement: 'enforced' },
  '/dev/supplier-library': { moduleId: 'dev', subModuleId: 'dev_supplier', enforcement: 'enforced' },

  '/listing': { moduleId: 'listing', subModuleId: 'listing_projects', enforcement: 'enforced' },
  '/listing/analysis': { moduleId: 'listing', subModuleId: 'listing_analysis', enforcement: 'enforced' },
  '/listing/comparison': { moduleId: 'listing', subModuleId: 'listing_comparison', enforcement: 'enforced' },
  '/listing/review-history': { moduleId: 'listing', subModuleId: 'listing_review_history', enforcement: 'enforced' },
  '/listing/review-aggregation': { moduleId: 'listing', subModuleId: 'listing_review_aggregation', enforcement: 'enforced' },
  '/listing/keywords': { moduleId: 'listing', subModuleId: 'listing_keywords', enforcement: 'enforced' },
  '/listing/ad-structure': { moduleId: 'listing', subModuleId: 'listing_ad_structure', enforcement: 'enforced' },
  '/listing/data-files': { moduleId: 'listing', subModuleId: 'listing_data_files', enforcement: 'enforced' },
  '/listing/generate': { moduleId: 'listing', subModuleId: 'listing_generate', enforcement: 'enforced' },
  '/listing/preview': { moduleId: 'listing', subModuleId: 'listing_preview', enforcement: 'enforced' },
  '/listing/score': { moduleId: 'listing', subModuleId: 'listing_score', enforcement: 'enforced' },
  '/listing/image-suggestions': { moduleId: 'listing', subModuleId: 'listing_image_workflow', enforcement: 'enforced' },
  '/listing/image-workflow': { moduleId: 'listing', subModuleId: 'listing_image_workflow', enforcement: 'enforced' },
  '/listing/project/:id': { moduleId: 'listing', subModuleId: 'listing_projects', enforcement: 'enforced' },

  '/ops': { moduleId: 'ops', subModuleId: 'ops_dashboard', enforcement: 'enforced' },
  '/ops/products': { moduleId: 'ops', subModuleId: 'ops_products', enforcement: 'catalog_only' },
  '/ops/products/:id': { moduleId: 'ops', subModuleId: 'ops_products', enforcement: 'catalog_only' },
  '/ops/products/erp/:source/:parentAsin': { moduleId: 'ops', subModuleId: 'ops_products', enforcement: 'catalog_only' },
  '/ops/products/import/:source/:parentAsin': { moduleId: 'ops', subModuleId: 'ops_products', enforcement: 'catalog_only' },
  '/ops/inventory': { moduleId: 'ops', subModuleId: 'ops_inventory', enforcement: 'catalog_only' },
  '/ops/ads': { moduleId: 'ops', subModuleId: 'ops_ads', enforcement: 'catalog_only' },
  '/ops/crawler': { moduleId: 'ops', subModuleId: 'ops_crawler', enforcement: 'catalog_only' },
  '/ops/shipping/:id': { moduleId: 'ops', subModuleId: 'ops_logistics', enforcement: 'catalog_only' },
  '/ops/logistics': { moduleId: 'ops', subModuleId: 'ops_logistics', enforcement: 'catalog_only' },
  '/ops/dashboard-upgrade': { moduleId: 'ops', subModuleId: 'ops_dashboard', enforcement: 'catalog_only' },
  '/ops/custom-dashboard': { moduleId: 'ops', subModuleId: 'ops_custom_dashboard', enforcement: 'catalog_only' },
  '/ops/data-import': { moduleId: 'ops', subModuleId: 'ops_data_import', enforcement: 'catalog_only' },
  '/ops/ad-mapping': { moduleId: 'ops', subModuleId: 'ops_ad_mapping', enforcement: 'catalog_only' },
  '/ops/ad-deep': { moduleId: 'ops', subModuleId: 'ops_ad_deep', enforcement: 'catalog_only' },
  '/ops/tasks': { moduleId: 'ops', subModuleId: 'ops_tasks', enforcement: 'catalog_only' },

  '/service': { moduleId: 'service', subModuleId: 'service_dashboard', enforcement: 'enforced' },
  '/service/reviews': { moduleId: 'service', subModuleId: 'service_reply', enforcement: 'catalog_only' },
  '/service/returns': { moduleId: 'service', subModuleId: 'service_returns', enforcement: 'catalog_only' },
  '/service/emails': { moduleId: 'service', subModuleId: 'service_templates', enforcement: 'catalog_only' },
  '/service/profiles': { moduleId: 'service', subModuleId: 'service_profiles', enforcement: 'catalog_only' },

  '/knowledge': { moduleId: 'knowledge', subModuleId: 'kb_overview', enforcement: 'enforced' },
  '/knowledge/bot': { moduleId: 'knowledge', subModuleId: 'kb_bot', enforcement: 'enforced' },
  '/knowledge/products': { moduleId: 'knowledge', subModuleId: 'kb_products', enforcement: 'enforced' },
  '/knowledge/listings': { moduleId: 'knowledge', subModuleId: 'kb_listings', enforcement: 'enforced' },
  '/knowledge/images': { moduleId: 'knowledge', subModuleId: 'kb_images', enforcement: 'enforced' },
  '/knowledge/skills': { moduleId: 'knowledge', subModuleId: 'kb_skills', enforcement: 'enforced' },
  '/knowledge/videos': { moduleId: 'knowledge', subModuleId: 'kb_videos', enforcement: 'enforced' },
  '/knowledge/intel': { moduleId: 'knowledge', subModuleId: 'kb_intel', enforcement: 'enforced' },

  '/admin/users': { moduleId: 'admin', subModuleId: 'admin_users', enforcement: 'enforced' },
  '/admin/review': { moduleId: 'admin', subModuleId: 'admin_review', enforcement: 'enforced' },
  '/admin/assignments': { moduleId: 'admin', subModuleId: 'admin_projects', enforcement: 'enforced' },
  '/admin/sop-access': { moduleId: 'admin', subModuleId: 'admin_sop_access', enforcement: 'enforced' },
  '/admin/roles': { moduleId: 'admin', subModuleId: 'admin_roles', enforcement: 'enforced' },
  '/admin/sync': { moduleId: 'admin', subModuleId: 'admin_sync', enforcement: 'enforced' },

  '/offsite': { moduleId: 'offsite', subModuleId: 'offsite_overview', enforcement: 'catalog_only' },
  '/offsite/influencers': { moduleId: 'offsite', subModuleId: 'offsite_influencers', enforcement: 'catalog_only' },
  '/offsite/campaigns': { moduleId: 'offsite', subModuleId: 'offsite_campaigns', enforcement: 'catalog_only' },
  '/offsite/outreach': { moduleId: 'offsite', subModuleId: 'offsite_outreach', enforcement: 'catalog_only' },
  '/offsite/content-review': { moduleId: 'offsite', subModuleId: 'offsite_content_review', enforcement: 'catalog_only' },
  '/offsite/social-accounts': { moduleId: 'offsite', subModuleId: 'offsite_social', enforcement: 'catalog_only' },
  '/offsite/content-calendar': { moduleId: 'offsite', subModuleId: 'offsite_calendar', enforcement: 'catalog_only' },
  '/offsite/tiktok-matrix': { moduleId: 'offsite', subModuleId: 'offsite_tiktok', enforcement: 'catalog_only' },
  '/offsite/attribution': { moduleId: 'offsite', subModuleId: 'offsite_attribution', enforcement: 'catalog_only' },
  '/offsite/analytics': { moduleId: 'offsite', subModuleId: 'offsite_analytics', enforcement: 'catalog_only' },

  '/emperor': { moduleId: 'emperor', subModuleId: 'emperor_skills', enforcement: 'catalog_only' },
  '/emperor/skills': { moduleId: 'emperor', subModuleId: 'emperor_skills', enforcement: 'catalog_only' },
  '/emperor/trace': { moduleId: 'emperor', subModuleId: 'emperor_trace', enforcement: 'catalog_only' },
  '/emperor/models': { moduleId: 'emperor', subModuleId: 'emperor_models', enforcement: 'catalog_only' },
  '/emperor/mcp': { moduleId: 'emperor', subModuleId: 'emperor_mcp', enforcement: 'catalog_only' },
  '/emperor/agents': { moduleId: 'emperor', subModuleId: 'emperor_agents', enforcement: 'catalog_only' },
  '/emperor/usage': { moduleId: 'emperor', subModuleId: 'emperor_usage', enforcement: 'catalog_only' },
  '/emperor/diagnostics': { moduleId: 'emperor', subModuleId: 'emperor_diagnostics', enforcement: 'catalog_only' },
  '/emperor/settings': { moduleId: 'emperor', subModuleId: 'emperor_settings', enforcement: 'catalog_only' },
  '/emperor/scheduled': { moduleId: 'emperor', subModuleId: 'emperor_schedules', enforcement: 'catalog_only' },
  '/emperor/knowledge': { moduleId: 'emperor', subModuleId: 'emperor_knowledge', enforcement: 'catalog_only' },
  '/emperor/observability': { moduleId: 'emperor', subModuleId: 'emperor_observability', enforcement: 'catalog_only' },
};

/**
 * Resource-to-directory registry used by server-side security governance.
 * It remains in the same permission catalogue as roles and routes so resource checks cannot
 * silently drift to a different module or sub-module definition.
 */
export const PERMISSION_RESOURCE_REGISTRY = {
  project: { moduleId: 'listing', subModuleId: 'listing_projects' },
  image_workflow: { moduleId: 'listing', subModuleId: 'listing_image_workflow' },
  product_development: { moduleId: 'dev', subModuleId: 'dev_projects' },
  knowledge: { moduleId: 'knowledge' },
  file: { moduleId: 'listing', subModuleId: 'listing_data_files' },
  tool: { moduleId: 'emperor', subModuleId: 'emperor_mcp' },
  agent: { moduleId: 'emperor', subModuleId: 'emperor_agents' },
  ops_data: { moduleId: 'ops', subModuleId: 'ops_dashboard' },
  offsite_campaign: { moduleId: 'offsite', subModuleId: 'offsite_campaigns' },
  emperor_skill: { moduleId: 'emperor', subModuleId: 'emperor_skills' },
} as const;

// Permission entry type for fine-grained control
export interface ModulePermission {
  moduleId: string;
  operations: PermissionOperation[];
  subModules?: {
    subModuleId: string;
    operations: PermissionOperation[];
  }[];
}

// Security governance v1: resource/action permission model.
export type SecurityResource = keyof typeof PERMISSION_RESOURCE_REGISTRY;
export const SECURITY_RESOURCES = Object.keys(PERMISSION_RESOURCE_REGISTRY) as SecurityResource[];

export const SECURITY_ACTIONS = [
  'read',
  'create',
  'update',
  'delete',
  'upload',
  'import',
  'export',
  'invoke',
  'run',
  'confirm',
  'cancel',
  'manage_secret',
  'rotate_secret',
  'assign',
  'sync',
] as const;
export type SecurityAction = typeof SECURITY_ACTIONS[number];

export const SECURITY_RESOURCE_MODULES: Record<SecurityResource, { moduleId: string; subModuleId?: string }> =
  PERMISSION_RESOURCE_REGISTRY;

export const SECURITY_ACTION_OPERATION: Record<SecurityAction, PermissionOperation> = {
  read: 'read',
  export: 'read',
  create: 'edit',
  update: 'edit',
  upload: 'edit',
  import: 'edit',
  invoke: 'edit',
  run: 'edit',
  confirm: 'edit',
  cancel: 'edit',
  assign: 'edit',
  sync: 'edit',
  delete: 'delete',
  manage_secret: 'delete',
  rotate_secret: 'delete',
};

export const SECURITY_PERMISSION_MATRIX: Record<string, Partial<Record<SecurityResource, SecurityAction[]>>> = {
  super_admin: {
    project: [...SECURITY_ACTIONS],
    product_development: [...SECURITY_ACTIONS],
    knowledge: [...SECURITY_ACTIONS],
    file: [...SECURITY_ACTIONS],
    tool: [...SECURITY_ACTIONS],
    agent: [...SECURITY_ACTIONS],
    ops_data: [...SECURITY_ACTIONS],
  },
  admin: {
    project: ['read', 'create', 'update', 'delete', 'assign'],
    product_development: ['read', 'create', 'update', 'delete', 'upload', 'import', 'export', 'run', 'confirm', 'cancel', 'assign'],
    knowledge: ['read', 'create', 'update', 'delete', 'upload', 'import', 'export', 'run', 'confirm', 'cancel'],
    file: ['read', 'upload', 'update', 'delete', 'export'],
    tool: ['read', 'create', 'update', 'delete', 'invoke', 'manage_secret', 'rotate_secret'],
    agent: ['read', 'create', 'update', 'delete', 'run', 'confirm', 'cancel'],
    ops_data: ['read', 'import', 'export', 'update', 'delete', 'sync'],
  },
  ops_manager: {
    project: ['read', 'create', 'update', 'assign'],
    knowledge: ['read', 'create', 'update', 'upload', 'import', 'export', 'run', 'confirm'],
    file: ['read', 'upload', 'update', 'export'],
    tool: ['read', 'invoke'],
    agent: ['read', 'run', 'confirm', 'cancel'],
    ops_data: ['read', 'import', 'export', 'update', 'sync'],
  },
  ops_specialist: {
    project: ['read', 'create', 'update'],
    knowledge: ['read', 'create', 'update', 'upload', 'import', 'export', 'run', 'confirm'],
    file: ['read', 'upload', 'update', 'export'],
    tool: ['read'],
    agent: ['read', 'run', 'confirm'],
    ops_data: ['read'],
  },
  product_dev: {
    project: ['read', 'create', 'update'],
    product_development: ['read', 'create', 'update', 'delete', 'upload', 'import', 'export', 'run', 'confirm', 'cancel'],
    knowledge: ['read', 'create', 'update', 'upload', 'import', 'export', 'run', 'confirm'],
    file: ['read', 'upload', 'update', 'export'],
    tool: ['read'],
    agent: ['read', 'run', 'confirm'],
  },
  finance: {
    project: ['read'],
    file: ['read', 'export'],
    ops_data: ['read', 'export'],
  },
  purchaser: {
    project: ['read'],
    file: ['read', 'export'],
  },
  designer: {
    project: ['read'],
    image_workflow: ['read'],
    product_development: ['read'],
    knowledge: ['read', 'create', 'update', 'upload', 'import', 'export'],
    file: ['read', 'upload', 'update', 'export'],
    agent: ['read'],
  },
};

// Password policy
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
