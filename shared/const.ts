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
  super_admin:    ['dev', 'listing', 'ops', 'service', 'knowledge', 'admin'],
  admin:          ['dev', 'listing', 'ops', 'service', 'knowledge', 'admin'],
  ops_manager:    ['listing', 'knowledge', 'ops'],
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
  knowledge: [
    { id: 'kb_products', label: '优秀产品创意库' },
    { id: 'kb_listings', label: '优秀Listing文案库' },
    { id: 'kb_images', label: '优秀图片知识库' },
    { id: 'kb_videos', label: '视频知识库' },
    { id: 'kb_skills', label: '运营技能知识库' },
  ],
  dev: [
    { id: 'dev_analysis', label: '选品分析' },
    { id: 'dev_profile', label: '产品画像' },
    { id: 'dev_bom', label: 'BOM管理' },
  ],
  listing: [
    { id: 'listing_create', label: 'Listing创建' },
    { id: 'listing_optimize', label: 'Listing优化' },
    { id: 'listing_keywords', label: '关键词管理' },
  ],
  ops: [
    { id: 'ops_profit', label: '利润分析' },
    { id: 'ops_inventory', label: '库存预警' },
    { id: 'ops_ads', label: '广告优化' },
    { id: 'ops_forecast', label: '销量预测' },
  ],
  service: [
    { id: 'service_reply', label: 'AI客服回复' },
    { id: 'service_returns', label: '退货分析' },
  ],
  admin: [
    { id: 'admin_users', label: '用户管理' },
    { id: 'admin_roles', label: '角色管理' },
    { id: 'admin_review', label: '审核中心' },
    { id: 'admin_projects', label: '项目分配' },
    { id: 'admin_sync', label: '同步与监控' },
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

// Password policy
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
