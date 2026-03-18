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

// Password policy
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
