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
    { id: 'ops_profit', label: '利润分析' },
    { id: 'ops_inventory', label: '库存预警' },
    { id: 'ops_ads', label: '广告优化' },
    { id: 'ops_forecast', label: '销量预测' },
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
  ],
};

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
export const SECURITY_RESOURCES = [
  'project',
  'product_development',
  'knowledge',
  'file',
  'tool',
  'agent',
  'ops_data',
] as const;
export type SecurityResource = typeof SECURITY_RESOURCES[number];

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

export const SECURITY_RESOURCE_MODULES: Record<SecurityResource, { moduleId: string; subModuleId?: string }> = {
  project: { moduleId: 'listing', subModuleId: 'listing_projects' },
  product_development: { moduleId: 'dev', subModuleId: 'dev_projects' },
  knowledge: { moduleId: 'knowledge' },
  file: { moduleId: 'listing', subModuleId: 'listing_data_files' },
  tool: { moduleId: 'emperor', subModuleId: 'emperor_mcp' },
  agent: { moduleId: 'emperor', subModuleId: 'emperor_agents' },
  ops_data: { moduleId: 'ops', subModuleId: 'ops_dashboard' },
};

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
