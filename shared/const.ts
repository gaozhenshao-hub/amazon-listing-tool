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
  super_admin:    ['design', 'dev', 'procurement', 'finance', 'listing', 'ops', 'knowledge', 'admin', 'emperor'],
  admin:          ['design', 'dev', 'procurement', 'finance', 'listing', 'ops', 'knowledge', 'admin', 'emperor'],
  ops_manager:    ['listing', 'knowledge', 'ops', 'procurement'],
  ops_specialist: ['listing', 'knowledge', 'ops'],
  product_dev:    ['dev', 'knowledge'],
  finance:        ['finance'],
  purchaser:      ['procurement'],
  designer:       ['design'],
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
  "design": [
    {
      "id": "design_images",
      "label": "生图"
    },
    {
      "id": "design_prompts",
      "label": "提示词库"
    },
    {
      "id": "design_materials",
      "label": "素材库"
    }
  ],
  "dev": [
    {
      "id": "dev_dashboard",
      "label": "产品开发（待开发）"
    }
  ],
  "procurement": [
    {
      "id": "procurement_logistics",
      "label": "物流时效分析"
    }
  ],
  "finance": [
    {
      "id": "finance_home",
      "label": "财务（待开发）"
    }
  ],
  "listing": [
    {
      "id": "listing_projects",
      "label": "项目管理"
    },
    {
      "id": "listing_analysis",
      "label": "Listing 抓取"
    },
    {
      "id": "listing_comparison",
      "label": "竞品对比分析"
    },
    {
      "id": "listing_review_history",
      "label": "上传记录"
    },
    {
      "id": "listing_review_aggregation",
      "label": "评论分析"
    },
    {
      "id": "listing_keywords",
      "label": "关键词"
    },
    {
      "id": "listing_ad_structure",
      "label": "广告架构"
    },
    {
      "id": "listing_data_files",
      "label": "项目资料"
    },
    {
      "id": "listing_generate",
      "label": "Listing 生成"
    },
    {
      "id": "listing_preview",
      "label": "生成结果"
    },
    {
      "id": "listing_score",
      "label": "Listing 评分"
    }
  ],
  "ops": [
    {
      "id": "ops_products",
      "label": "产品总览"
    },
    {
      "id": "ops_tasks",
      "label": "任务看板与会议"
    },
    {
      "id": "ops_dashboard",
      "label": "利润与产品看板"
    },
    {
      "id": "ops_data_import",
      "label": "财务、库存数据与赛狐同步"
    },
    {
      "id": "ops_inventory",
      "label": "库存刷新"
    },
    {
      "id": "ops_ads",
      "label": "广告看板（待开发）"
    },
    {
      "id": "ops_logistics",
      "label": "物流数据"
    }
  ],
  "knowledge": [
    {
      "id": "kb_images",
      "label": "图片知识库与采集审核"
    }
  ],
  "admin": [
    {
      "id": "admin_users",
      "label": "用户管理"
    },
    {
      "id": "admin_roles",
      "label": "角色管理"
    }
  ],
  "emperor": [
    {
      "id": "emperor_skills",
      "label": "Skill 库"
    },
    {
      "id": "emperor_agents",
      "label": "Agent 库"
    },
    {
      "id": "emperor_models",
      "label": "模型管理"
    },
    {
      "id": "emperor_settings",
      "label": "通用设置"
    }
  ]
};

/**
 * 单公司权限目录唯一来源。角色编辑页、前台路由守卫和资源级授权均应从此目录派生，
 * 禁止再单独维护模块列表。
 */
export const PERMISSION_MODULES = [
  {
    "id": "design",
    "label": "美工",
    "description": "生图、提示词和素材"
  },
  {
    "id": "dev",
    "label": "产品开发",
    "description": "待开发"
  },
  {
    "id": "procurement",
    "label": "采购物流",
    "description": "物流时效分析"
  },
  {
    "id": "finance",
    "label": "财务",
    "description": "待开发"
  },
  {
    "id": "ops",
    "label": "运营",
    "description": "产品、库存、任务、看板和赛狐同步"
  },
  {
    "id": "listing",
    "label": "运营 · Listing 与广告搭建",
    "description": "项目资料、采集分析、Listing 生成和广告搭建"
  },
  {
    "id": "knowledge",
    "label": "知识库",
    "description": "图片知识库、受控采集与审核"
  },
  {
    "id": "emperor",
    "label": "AI 管理",
    "description": "Skill、Agent、模型和通用设置"
  },
  {
    "id": "admin",
    "label": "系统管理",
    "description": "角色管理和用户管理"
  }
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
  '/design/images': { moduleId: 'design', subModuleId: 'design_images', enforcement: 'enforced' },
  '/design/prompts': { moduleId: 'design', subModuleId: 'design_prompts', enforcement: 'enforced' },
  '/design/materials': { moduleId: 'design', subModuleId: 'design_materials', enforcement: 'enforced' },
  '/dev': { moduleId: 'dev', subModuleId: 'dev_dashboard', enforcement: 'enforced' },

  '/listing': { moduleId: 'listing', subModuleId: 'listing_projects', enforcement: 'enforced' },
  '/listing/analysis': { moduleId: 'listing', subModuleId: 'listing_analysis', enforcement: 'enforced' },
  '/listing/comparison': { moduleId: 'listing', subModuleId: 'listing_comparison', enforcement: 'enforced' },
  '/listing/review-history': { moduleId: 'listing', subModuleId: 'listing_review_history', enforcement: 'enforced' },
  '/listing/review-aggregation': { moduleId: 'listing', subModuleId: 'listing_review_aggregation', enforcement: 'enforced' },
  '/listing/buyer-questions': { moduleId: 'listing', subModuleId: 'listing_analysis', enforcement: 'enforced' },
  '/listing/keywords': { moduleId: 'listing', subModuleId: 'listing_keywords', enforcement: 'enforced' },
  '/listing/ad-structure': { moduleId: 'listing', subModuleId: 'listing_ad_structure', enforcement: 'enforced' },
  '/listing/data-files': { moduleId: 'listing', subModuleId: 'listing_data_files', enforcement: 'enforced' },
  '/listing/generate': { moduleId: 'listing', subModuleId: 'listing_generate', enforcement: 'enforced' },
  '/listing/preview': { moduleId: 'listing', subModuleId: 'listing_preview', enforcement: 'enforced' },
  '/listing/score': { moduleId: 'listing', subModuleId: 'listing_score', enforcement: 'enforced' },
  '/listing/project/:id': { moduleId: 'listing', subModuleId: 'listing_projects', enforcement: 'enforced' },

  '/ops': { moduleId: 'ops', subModuleId: 'ops_dashboard', enforcement: 'enforced' },
  '/ops/products': { moduleId: 'ops', subModuleId: 'ops_products', enforcement: 'catalog_only' },
  '/ops/products/:id': { moduleId: 'ops', subModuleId: 'ops_products', enforcement: 'catalog_only' },
  '/ops/products/erp/:source/:parentAsin': { moduleId: 'ops', subModuleId: 'ops_products', enforcement: 'catalog_only' },
  '/ops/products/import/:source/:parentAsin': { moduleId: 'ops', subModuleId: 'ops_products', enforcement: 'catalog_only' },
  '/ops/inventory': { moduleId: 'ops', subModuleId: 'ops_data_import', enforcement: 'enforced' },
  '/ops/inventory-details': { moduleId: 'ops', subModuleId: 'ops_data_import', enforcement: 'enforced' },
  '/ops/saihu-sync': { moduleId: 'ops', subModuleId: 'ops_data_import', enforcement: 'enforced' },
  '/ops/product-board': { moduleId: 'ops', subModuleId: 'ops_data_import', enforcement: 'enforced' },
  '/ops/profit-board': { moduleId: 'ops', subModuleId: 'ops_data_import', enforcement: 'enforced' },
  '/ops/product-tasks': { moduleId: 'ops', subModuleId: 'ops_tasks', enforcement: 'enforced' },
  '/ops/ads': { moduleId: 'ops', subModuleId: 'ops_ads', enforcement: 'catalog_only' },
  '/ops/logistics': { moduleId: 'ops', subModuleId: 'ops_logistics', enforcement: 'catalog_only' },
  '/ops/task-tools': { moduleId: 'ops', subModuleId: 'ops_tasks', enforcement: 'enforced' },
  '/ops/tasks': { moduleId: 'ops', subModuleId: 'ops_tasks', enforcement: 'enforced' },


  '/knowledge': { moduleId: 'knowledge', subModuleId: 'kb_images', enforcement: 'enforced' },
  '/knowledge/images': { moduleId: 'knowledge', subModuleId: 'kb_images', enforcement: 'enforced' },

  '/admin/users': { moduleId: 'admin', subModuleId: 'admin_users', enforcement: 'enforced' },
  '/admin/roles': { moduleId: 'admin', subModuleId: 'admin_roles', enforcement: 'enforced' },


  '/emperor': { moduleId: 'emperor', subModuleId: 'emperor_skills', enforcement: 'catalog_only' },
  '/emperor/skills': { moduleId: 'emperor', subModuleId: 'emperor_skills', enforcement: 'catalog_only' },
  '/emperor/models': { moduleId: 'emperor', subModuleId: 'emperor_models', enforcement: 'catalog_only' },
  '/emperor/agent-library': { moduleId: 'emperor', subModuleId: 'emperor_agents', enforcement: 'enforced' },
  '/emperor/settings': { moduleId: 'emperor', subModuleId: 'emperor_settings', enforcement: 'catalog_only' },
  '/finance': { moduleId: 'finance', subModuleId: 'finance_home', enforcement: 'enforced' },
  '/procurement': { moduleId: 'procurement', subModuleId: 'procurement_logistics', enforcement: 'enforced' },
  '/procurement/shipping/:id': { moduleId: 'procurement', subModuleId: 'procurement_logistics', enforcement: 'enforced' },
  '/knowledge/acquisition': { moduleId: 'knowledge', subModuleId: 'kb_images', enforcement: 'enforced' },
  '/knowledge/acquisition/review/:snapshotId': { moduleId: 'knowledge', subModuleId: 'kb_images', enforcement: 'enforced' },
  '/knowledge/acquisition/job/:jobId': { moduleId: 'knowledge', subModuleId: 'kb_images', enforcement: 'enforced' },
  '/listing/acquisition/review/:snapshotId': { moduleId: 'listing', subModuleId: 'listing_analysis', enforcement: 'enforced' },
  '/ops/products/view/:parentAsin': { moduleId: 'ops', subModuleId: 'ops_products', enforcement: 'enforced' },
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
  tool: { moduleId: 'emperor', subModuleId: 'emperor_settings' },
  agent: { moduleId: 'emperor', subModuleId: 'emperor_agents' },
  ops_data: { moduleId: 'ops', subModuleId: 'ops_dashboard' },
  procurement_logistics: { moduleId: 'procurement', subModuleId: 'procurement_logistics' },
  // Board archives, responsible-person notes and explicit numeric pairings are
  // separate from financial imports, task writes and supplier synchronization.
  ops_board: { moduleId: 'ops', subModuleId: 'ops_dashboard' },
  // Task actions are additionally row-scoped on the server. They do not grant
  // financial writes, sync, task deletion, or access to another assignee's task.
  ops_task: { moduleId: 'ops', subModuleId: 'ops_tasks' },
  // Saving a scoped cost sheet does not authorize report imports, inventory
  // synchronization, task assignment, or other mutations of ops_data.
  ops_cost_sheet: { moduleId: 'ops', subModuleId: 'ops_data_import' },
  // Whole month/store/country imports are a separate manager operation.
  // This grants neither scheduled sync nor access to another resource.
  ops_monthly_import: { moduleId: 'ops', subModuleId: 'ops_data_import' },
  // Explicit manager-only full inventory collection; not planning edits or a
  // grant to enable the supplier's weekly/monthly/inventory schedules.
  ops_inventory_collection: { moduleId: 'ops', subModuleId: 'ops_inventory' },
  ops_inventory_planning: { moduleId: 'ops', subModuleId: 'ops_inventory' },
  // Workspace-shared owner rules and lifecycle restoration are separate from
  // actor-private planning values and do not authorize source synchronization.
  ops_inventory_governance: { moduleId: 'ops', subModuleId: 'ops_inventory' },
  offsite_campaign: { moduleId: 'offsite', subModuleId: 'offsite_campaigns' },
  emperor_skill: { moduleId: 'emperor', subModuleId: 'emperor_skills' },
  conversation: { moduleId: 'emperor', subModuleId: 'emperor_conversations' },
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
    procurement_logistics: [...SECURITY_ACTIONS],
    project: [...SECURITY_ACTIONS],
    product_development: [...SECURITY_ACTIONS],
    knowledge: [...SECURITY_ACTIONS],
    file: [...SECURITY_ACTIONS],
    tool: [...SECURITY_ACTIONS],
    agent: [...SECURITY_ACTIONS],
    conversation: [...SECURITY_ACTIONS],
    ops_data: [...SECURITY_ACTIONS],
    ops_board: ['read', 'create', 'update', 'assign'],
    ops_task: ['read', 'create', 'update', 'upload', 'export', 'delete', 'assign'],
    ops_cost_sheet: ['read', 'update'],
    ops_monthly_import: ['read', 'create', 'update', 'delete'],
    ops_inventory_collection: ['read', 'create', 'cancel'],
    ops_inventory_planning: ['read', 'update', 'cancel'],
    ops_inventory_governance: ['read', 'update', 'cancel'],
  },
  admin: {
    emperor_skill: ['read', 'create', 'update', 'run'],
    procurement_logistics: ['read', 'update', 'import', 'export', 'delete', 'sync'],
    project: ['read', 'create', 'update', 'delete', 'assign'],
    product_development: ['read', 'create', 'update', 'delete', 'upload', 'import', 'export', 'run', 'confirm', 'cancel', 'assign'],
    knowledge: ['read', 'create', 'update', 'delete', 'upload', 'import', 'export', 'run', 'confirm', 'cancel'],
    file: ['read', 'upload', 'update', 'delete', 'export'],
    tool: ['read', 'create', 'update', 'delete', 'invoke', 'manage_secret', 'rotate_secret'],
    agent: ['read', 'create', 'update', 'delete', 'run', 'confirm', 'cancel'],
    conversation: ['read', 'create', 'update', 'delete', 'upload', 'run', 'confirm', 'cancel'],
    ops_data: ['read', 'import', 'export', 'update', 'delete', 'sync'],
    ops_board: ['read', 'create', 'update', 'assign'],
    ops_task: ['read', 'create', 'update', 'upload', 'export', 'delete', 'assign'],
    ops_cost_sheet: ['read', 'update'],
    ops_monthly_import: ['read', 'create', 'update', 'delete'],
    ops_inventory_collection: ['read', 'create', 'cancel'],
    ops_inventory_planning: ['read', 'update', 'cancel'],
    ops_inventory_governance: ['read', 'update', 'cancel'],
  },
  ops_manager: {
    procurement_logistics: ['read', 'update', 'import', 'export', 'sync'],
    project: ['read', 'create', 'update', 'assign'],
    knowledge: ['read', 'create', 'update', 'upload', 'import', 'export', 'run', 'confirm'],
    file: ['read', 'upload', 'update', 'export'],
    tool: ['read', 'invoke'],
    agent: ['read', 'run', 'confirm', 'cancel'],
    conversation: ['read', 'create', 'update', 'upload', 'run', 'confirm', 'cancel'],
    ops_data: ['read', 'import', 'export', 'update', 'sync'],
    ops_board: ['read', 'update'],
    ops_task: ['read', 'create', 'update', 'upload', 'export', 'delete', 'assign'],
    ops_cost_sheet: ['read', 'update'],
    ops_monthly_import: ['read', 'create', 'update', 'delete'],
    ops_inventory_collection: ['read', 'create', 'cancel'],
    ops_inventory_planning: ['read', 'update', 'cancel'],
    ops_inventory_governance: ['read', 'update', 'cancel'],
  },
  ops_specialist: {
    project: ['read', 'create', 'update'],
    knowledge: ['read', 'create', 'update', 'upload', 'import', 'export', 'run', 'confirm'],
    file: ['read', 'upload', 'update', 'export'],
    tool: ['read'],
    agent: ['read', 'run', 'confirm'],
    conversation: ['read', 'create', 'update', 'upload', 'run', 'confirm'],
    ops_data: ['read'],
    ops_board: ['read', 'update'],
    ops_task: ['read', 'create', 'update', 'upload', 'export', 'delete'],
    ops_cost_sheet: ['read', 'update'],
  },
  product_dev: {
    project: ['read', 'create', 'update'],
    product_development: ['read', 'create', 'update', 'delete', 'upload', 'import', 'export', 'run', 'confirm', 'cancel'],
    knowledge: ['read', 'create', 'update', 'upload', 'import', 'export', 'run', 'confirm'],
    file: ['read', 'upload', 'update', 'export'],
    tool: ['read'],
    agent: ['read', 'run', 'confirm'],
    conversation: ['read', 'create', 'update', 'upload', 'run', 'confirm'],
  },
  finance: {
    project: ['read'],
    file: ['read', 'export'],
    ops_data: ['read', 'export'],
    ops_board: ['read'],
  },
  purchaser: {
    procurement_logistics: ['read', 'export'],
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
