import React, { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Shield,
  Globe,
  Server,
  TestTube2,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Zap,
  Clock,
  Settings2,
  ChevronRight,
  ExternalLink,
  Network,
  Activity,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

// Proxy setting keys (must match backend)
const KEYS = {
  PROXY_ENABLED: "proxy_enabled",
  PROXY_PROVIDER: "proxy_provider",
  PROXY_URL: "proxy_url",
  PROXY_HOST: "proxy_host",
  PROXY_PORT: "proxy_port",
  PROXY_USERNAME: "proxy_username",
  PROXY_PASSWORD: "proxy_password",
  PROXY_PROTOCOL: "proxy_protocol",
  SCRAPER_MAX_RETRIES: "scraper_max_retries",
  SCRAPER_TIMEOUT: "scraper_timeout",
  SCRAPER_MIN_DELAY: "scraper_min_delay",
  SCRAPER_MAX_DELAY: "scraper_max_delay",
};

// Lingxing proxy keys
const LX_KEYS = {
  ENABLED: "lx_proxy_enabled",
  PROTOCOL: "lx_proxy_protocol",
  HOST: "lx_proxy_host",
  PORT: "lx_proxy_port",
  USERNAME: "lx_proxy_username",
  PASSWORD: "lx_proxy_password",
  URL: "lx_proxy_url",
};

// Provider info for display
const PROVIDER_INFO: Record<string, { name: string; color: string; description: string; website: string }> = {
  smartproxy: {
    name: "SmartProxy",
    color: "bg-blue-500",
    description: "全球4000万+住宅IP，支持亚马逊专用通道",
    website: "https://smartproxy.com",
  },
  oxylabs: {
    name: "Oxylabs",
    color: "bg-green-500",
    description: "企业级代理，100M+住宅IP池，高成功率",
    website: "https://oxylabs.io",
  },
  brightdata: {
    name: "Bright Data",
    color: "bg-purple-500",
    description: "全球最大代理网络，72M+住宅IP",
    website: "https://brightdata.com",
  },
  scrapingbee: {
    name: "ScrapingBee",
    color: "bg-yellow-500",
    description: "内置JS渲染，自动轮换IP和UA",
    website: "https://www.scrapingbee.com",
  },
  scraperapi: {
    name: "ScraperAPI",
    color: "bg-red-500",
    description: "简单API接口，自动处理CAPTCHA",
    website: "https://www.scraperapi.com",
  },
  custom: {
    name: "自定义代理",
    color: "bg-gray-500",
    description: "使用自有代理服务器或其他代理服务商",
    website: "",
  },
};

export default function SystemSettings() {
  const { data: proxyData, isLoading, refetch } = trpc.systemSettings.getProxyConfig.useQuery();
  const updateMutation = trpc.systemSettings.updateProxyConfig.useMutation({
    onSuccess: () => { toast.success("代理配置已保存"); refetch(); },
    onError: (err) => toast.error(`保存失败: ${err.message}`),
  });
  const presetMutation = trpc.systemSettings.applyProviderPreset.useMutation({
    onSuccess: () => { toast.success("供应商预设已应用"); refetch(); },
    onError: (err) => toast.error(`应用预设失败: ${err.message}`),
  });
  const testProxyMutation = trpc.systemSettings.testProxy.useMutation();
  const testScrapeMutation = trpc.systemSettings.testScrape.useMutation();

  // Local form state
  const [form, setForm] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<{ type: "proxy" | "scrape"; success: boolean; message: string; latency?: number | null } | null>(null);

  // Sync server data to local form
  useEffect(() => {
    if (proxyData?.config) {
      const c = proxyData.config;
      setForm({
        [KEYS.PROXY_ENABLED]: c[KEYS.PROXY_ENABLED] || "false",
        [KEYS.PROXY_PROVIDER]: c[KEYS.PROXY_PROVIDER] || "",
        [KEYS.PROXY_URL]: c[KEYS.PROXY_URL] || "",
        [KEYS.PROXY_HOST]: c[KEYS.PROXY_HOST] || "",
        [KEYS.PROXY_PORT]: c[KEYS.PROXY_PORT] || "",
        [KEYS.PROXY_USERNAME]: c[KEYS.PROXY_USERNAME] || "",
        [KEYS.PROXY_PASSWORD]: c[KEYS.PROXY_PASSWORD] || "",
        [KEYS.PROXY_PROTOCOL]: c[KEYS.PROXY_PROTOCOL] || "http",
        [KEYS.SCRAPER_MAX_RETRIES]: c[KEYS.SCRAPER_MAX_RETRIES] || "3",
        [KEYS.SCRAPER_TIMEOUT]: c[KEYS.SCRAPER_TIMEOUT] || "30000",
        [KEYS.SCRAPER_MIN_DELAY]: c[KEYS.SCRAPER_MIN_DELAY] || "1000",
        [KEYS.SCRAPER_MAX_DELAY]: c[KEYS.SCRAPER_MAX_DELAY] || "3000",
      });
    }
  }, [proxyData]);

  const updateField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const isEnabled = form[KEYS.PROXY_ENABLED] === "true";
  const selectedProvider = form[KEYS.PROXY_PROVIDER] || "";

  const handleSave = () => {
    updateMutation.mutate({ settings: form });
  };

  const handleApplyPreset = (provider: string) => {
    presetMutation.mutate({ provider }, {
      onSuccess: () => {
        updateField(KEYS.PROXY_PROVIDER, provider);
      },
    });
  };

  const handleTestProxy = async () => {
    setTestResult(null);
    const result = await testProxyMutation.mutateAsync();
    setTestResult({ type: "proxy", ...result });
  };

  const handleTestScrape = async () => {
    setTestResult(null);
    const result = await testScrapeMutation.mutateAsync();
    setTestResult({ type: "scrape", ...result });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings2 className="h-6 w-6 text-primary" />
          系统设置
        </h1>
        <p className="text-muted-foreground mt-1">管理领星API连接、代理配置和爬虫策略</p>
      </div>

      <Tabs defaultValue="lingxing" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="lingxing" className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            领星API
          </TabsTrigger>
          <TabsTrigger value="proxy" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            爬虫代理
          </TabsTrigger>
          <TabsTrigger value="scraper" className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            爬虫策略
          </TabsTrigger>
          <TabsTrigger value="test" className="flex items-center gap-2">
            <TestTube2 className="h-4 w-4" />
            连接测试
          </TabsTrigger>
        </TabsList>

        {/* ═══════════════════ Lingxing API Config Tab ═══════════════════ */}
        <TabsContent value="lingxing" className="space-y-6">
          <LingxingApiSettings />
        </TabsContent>

        {/* ═══════════════════ Proxy Configuration Tab ═══════════════════ */}
        <TabsContent value="proxy" className="space-y-6">
          {/* Enable/Disable Toggle */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Globe className="h-5 w-5 text-blue-500" />
                    爬虫代理服务
                  </CardTitle>
                  <CardDescription>启用代理后，所有亚马逊爬取请求将通过代理服务器转发</CardDescription>
                </div>
                <Button
                  variant={isEnabled ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    const newVal = isEnabled ? "false" : "true";
                    updateField(KEYS.PROXY_ENABLED, newVal);
                    updateMutation.mutate({ settings: { [KEYS.PROXY_ENABLED]: newVal } });
                  }}
                >
                  {isEnabled ? (
                    <><CheckCircle2 className="h-4 w-4 mr-1" /> 已启用</>
                  ) : (
                    <><XCircle className="h-4 w-4 mr-1" /> 未启用</>
                  )}
                </Button>
              </div>
            </CardHeader>
          </Card>

          {/* Provider Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">选择代理供应商</CardTitle>
              <CardDescription>选择预设供应商可自动填充主机和端口信息，您只需填写账号密码</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.entries(PROVIDER_INFO).map(([key, info]) => (
                  <button
                    key={key}
                    onClick={() => {
                      if (key === "custom") {
                        updateField(KEYS.PROXY_PROVIDER, "custom");
                      } else {
                        handleApplyPreset(key);
                      }
                    }}
                    className={`relative p-4 rounded-xl border-2 text-left transition-all hover:shadow-md ${
                      selectedProvider === key
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border hover:border-primary/30"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-3 h-3 rounded-full ${info.color}`} />
                      <span className="font-semibold text-sm">{info.name}</span>
                      {selectedProvider === key && (
                        <Badge variant="secondary" className="ml-auto text-xs">当前</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{info.description}</p>
                    {info.website && (
                      <a
                        href={info.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary mt-2 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        官网 <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Connection Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">连接信息</CardTitle>
              <CardDescription>配置代理服务器的连接参数</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Direct URL */}
              <div>
                <Label>完整代理URL（可选，优先使用）</Label>
                <Input
                  placeholder="例如: http://user:pass@proxy.example.com:8080"
                  value={form[KEYS.PROXY_URL] || ""}
                  onChange={e => updateField(KEYS.PROXY_URL, e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">如果填写了完整URL，下方的分项配置将被忽略</p>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>协议</Label>
                  <Select value={form[KEYS.PROXY_PROTOCOL] || "http"} onValueChange={v => updateField(KEYS.PROXY_PROTOCOL, v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="http">HTTP</SelectItem>
                      <SelectItem value="https">HTTPS</SelectItem>
                      <SelectItem value="socks5">SOCKS5</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>主机</Label>
                  <Input placeholder="proxy.example.com" value={form[KEYS.PROXY_HOST] || ""} onChange={e => updateField(KEYS.PROXY_HOST, e.target.value)} />
                </div>
                <div>
                  <Label>端口</Label>
                  <Input placeholder="8080" value={form[KEYS.PROXY_PORT] || ""} onChange={e => updateField(KEYS.PROXY_PORT, e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>用户名</Label>
                  <Input placeholder="代理用户名" value={form[KEYS.PROXY_USERNAME] || ""} onChange={e => updateField(KEYS.PROXY_USERNAME, e.target.value)} />
                </div>
                <div>
                  <Label>密码</Label>
                  <Input type="password" placeholder="代理密码" value={form[KEYS.PROXY_PASSWORD] || ""} onChange={e => updateField(KEYS.PROXY_PASSWORD, e.target.value)} />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button onClick={handleSave} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> 保存中...</>
                  ) : (
                    "保存配置"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════════════════ Scraper Strategy Tab ═══════════════════ */}
        <TabsContent value="scraper" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Zap className="h-5 w-5 text-amber-500" />
                爬虫请求策略
              </CardTitle>
              <CardDescription>调整爬虫的重试次数、超时时间和请求间隔，平衡速度与稳定性</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>最大重试次数</Label>
                  <Input type="number" value={form[KEYS.SCRAPER_MAX_RETRIES] || "3"} onChange={e => updateField(KEYS.SCRAPER_MAX_RETRIES, e.target.value)} />
                </div>
                <div>
                  <Label>请求超时 (ms)</Label>
                  <Input type="number" value={form[KEYS.SCRAPER_TIMEOUT] || "30000"} onChange={e => updateField(KEYS.SCRAPER_TIMEOUT, e.target.value)} />
                </div>
                <div>
                  <Label>最小请求间隔 (ms)</Label>
                  <Input type="number" value={form[KEYS.SCRAPER_MIN_DELAY] || "1000"} onChange={e => updateField(KEYS.SCRAPER_MIN_DELAY, e.target.value)} />
                </div>
                <div>
                  <Label>最大请求间隔 (ms)</Label>
                  <Input type="number" value={form[KEYS.SCRAPER_MAX_DELAY] || "3000"} onChange={e => updateField(KEYS.SCRAPER_MAX_DELAY, e.target.value)} />
                </div>
              </div>

              {/* Quick presets */}
              <div className="flex items-center gap-2 pt-2">
                <span className="text-sm text-muted-foreground">快速预设:</span>
                <Button variant="outline" size="sm" onClick={() => {
                  updateField(KEYS.SCRAPER_MAX_RETRIES, "3");
                  updateField(KEYS.SCRAPER_TIMEOUT, "30000");
                  updateField(KEYS.SCRAPER_MIN_DELAY, "1000");
                  updateField(KEYS.SCRAPER_MAX_DELAY, "3000");
                }}>
                  标准模式
                </Button>
                <Button variant="outline" size="sm" onClick={() => {
                  updateField(KEYS.SCRAPER_MAX_RETRIES, "5");
                  updateField(KEYS.SCRAPER_TIMEOUT, "60000");
                  updateField(KEYS.SCRAPER_MIN_DELAY, "2000");
                  updateField(KEYS.SCRAPER_MAX_DELAY, "5000");
                }}>
                  稳定模式
                </Button>
                <Button variant="outline" size="sm" onClick={() => {
                  updateField(KEYS.SCRAPER_MAX_RETRIES, "8");
                  updateField(KEYS.SCRAPER_TIMEOUT, "90000");
                  updateField(KEYS.SCRAPER_MIN_DELAY, "3000");
                  updateField(KEYS.SCRAPER_MAX_DELAY, "8000");
                }}>
                  保守模式
                </Button>
              </div>

              <div className="flex justify-end pt-2">
                <Button onClick={handleSave} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> 保存中...</>
                  ) : (
                    "保存策略"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════════════════ Connection Test Tab ═══════════════════ */}
        <TabsContent value="test" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TestTube2 className="h-5 w-5 text-emerald-500" />
                连接测试
              </CardTitle>
              <CardDescription>测试代理连接和爬虫功能是否正常工作</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Proxy Test */}
                <div className="p-4 rounded-xl border space-y-3">
                  <div className="flex items-center gap-2">
                    <Globe className="h-5 w-5 text-blue-500" />
                    <div>
                      <p className="font-medium text-sm">爬虫代理测试</p>
                      <p className="text-xs text-muted-foreground">通过代理访问httpbin.org验证连通性</p>
                    </div>
                  </div>
                  <Button
                    onClick={handleTestProxy}
                    disabled={testProxyMutation.isPending}
                    className="w-full"
                    variant="outline"
                  >
                    {testProxyMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> 测试中...</>
                    ) : (
                      <><TestTube2 className="h-4 w-4 mr-2" /> 测试爬虫代理</>
                    )}
                  </Button>
                </div>

                {/* Scrape Test */}
                <div className="p-4 rounded-xl border space-y-3">
                  <div className="flex items-center gap-2">
                    <Server className="h-5 w-5 text-orange-500" />
                    <div>
                      <p className="font-medium text-sm">爬虫功能测试</p>
                      <p className="text-xs text-muted-foreground">尝试爬取一个亚马逊测试页面</p>
                    </div>
                  </div>
                  <Button
                    onClick={handleTestScrape}
                    disabled={testScrapeMutation.isPending}
                    className="w-full"
                    variant="outline"
                  >
                    {testScrapeMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> 爬取中...</>
                    ) : (
                      <><Zap className="h-4 w-4 mr-2" /> 测试爬虫功能</>
                    )}
                  </Button>
                </div>
              </div>

              {/* Test Result */}
              {testResult && (
                <div
                  className={`p-4 rounded-xl border-2 ${
                    testResult.success
                      ? "border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/20"
                      : "border-red-500/30 bg-red-50 dark:bg-red-950/20"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {testResult.success ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium text-sm ${testResult.success ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                        {testResult.type === "proxy" ? "代理测试" : "爬虫测试"}
                        {testResult.success ? "成功" : "失败"}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">{testResult.message}</p>
                      {testResult.latency != null && (
                        <p className="text-xs text-muted-foreground mt-1">
                          延迟: {testResult.latency}ms
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Tips */}
              <div className="p-4 rounded-xl bg-muted/50 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <ChevronRight className="h-4 w-4" />
                  使用建议
                </p>
                <ul className="text-xs text-muted-foreground space-y-1 ml-6 list-disc">
                  <li>首次配置代理后，建议先运行"代理连接测试"确认连通性</li>
                  <li>如果代理测试通过但爬虫测试失败，可能是代理IP被亚马逊封禁，建议更换IP池</li>
                  <li>住宅代理（Residential Proxy）的成功率远高于数据中心代理（Datacenter Proxy）</li>
                  <li>批量爬取时建议使用"稳定模式"或"保守模式"，避免触发亚马逊反爬</li>
                  <li>SmartProxy和Oxylabs提供亚马逊专用通道，推荐优先使用</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Lingxing API Settings Component (with integrated proxy config)
// ═══════════════════════════════════════════════════════════════════════

function LingxingApiSettings() {
  // Lingxing config
  const { data, isLoading, refetch } = trpc.systemSettings.getLingxingConfig.useQuery();
  const updateMut = trpc.systemSettings.updateLingxingConfig.useMutation({
    onSuccess: (res) => {
      refetch();
      refetchProxy();
      toast.success(res.isMock ? "配置已保存（Mock模式）" : "配置已保存并应用");
    },
    onError: (e) => toast.error(e.message),
  });
  const testMut = trpc.systemSettings.testLingxingConnection.useMutation();

  // Lingxing proxy config
  const { data: proxyData, isLoading: proxyLoading, refetch: refetchProxy } = trpc.systemSettings.getLingxingProxyConfig.useQuery();
  const updateProxyMut = trpc.systemSettings.updateLingxingProxyConfig.useMutation({
    onSuccess: (res) => {
      refetchProxy();
      toast.success(res.proxyEnabled ? "代理配置已保存并启用" : "代理配置已保存");
    },
    onError: (e) => toast.error(e.message),
  });
  const testProxyMut = trpc.systemSettings.testLingxingProxy.useMutation();

  // API logs
  const { data: logsData, refetch: refetchLogs } = trpc.systemSettings.getLingxingApiLogs.useQuery({ limit: 20 });

  const [form, setForm] = useState({
    appId: "",
    appSecret: "",
    apiHost: "https://openapi.lingxing.com",
    useMock: true,
  });

  const [proxyForm, setProxyForm] = useState({
    [LX_KEYS.ENABLED]: "false",
    [LX_KEYS.PROTOCOL]: "http",
    [LX_KEYS.HOST]: "",
    [LX_KEYS.PORT]: "",
    [LX_KEYS.USERNAME]: "",
    [LX_KEYS.PASSWORD]: "",
    [LX_KEYS.URL]: "",
  });

  const [initialized, setInitialized] = useState(false);
  const [proxyInitialized, setProxyInitialized] = useState(false);

  // Initialize form from data
  React.useEffect(() => {
    if (data && !initialized) {
      setForm({
        appId: data.dbConfig?.lingxing_app_id || "",
        appSecret: data.dbConfig?.lingxing_app_secret || "",
        apiHost: data.dbConfig?.lingxing_api_host || data.currentConfig.apiHost || "https://openapi.lingxing.com",
        useMock: data.currentConfig.useMock,
      });
      setInitialized(true);
    }
  }, [data, initialized]);

  // Initialize proxy form
  React.useEffect(() => {
    if (proxyData && !proxyInitialized) {
      const c = proxyData.config;
      setProxyForm({
        [LX_KEYS.ENABLED]: c[LX_KEYS.ENABLED] || "false",
        [LX_KEYS.PROTOCOL]: c[LX_KEYS.PROTOCOL] || "http",
        [LX_KEYS.HOST]: c[LX_KEYS.HOST] || "",
        [LX_KEYS.PORT]: c[LX_KEYS.PORT] || "",
        [LX_KEYS.USERNAME]: c[LX_KEYS.USERNAME] || "",
        [LX_KEYS.PASSWORD]: c[LX_KEYS.PASSWORD] || "",
        [LX_KEYS.URL]: c[LX_KEYS.URL] || "",
      });
      setProxyInitialized(true);
    }
  }, [proxyData, proxyInitialized]);

  const handleSave = () => {
    updateMut.mutate({
      appId: form.appId,
      appSecret: form.appSecret,
      apiHost: form.apiHost,
      useMock: form.useMock,
    });
  };

  const handleTest = () => {
    testMut.mutate();
  };

  const handleSaveProxy = () => {
    updateProxyMut.mutate({ settings: proxyForm });
  };

  const handleTestProxy = () => {
    testProxyMut.mutate();
  };

  const proxyEnabled = proxyForm[LX_KEYS.ENABLED] === "true";

  if (isLoading || proxyLoading) {
    return <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />)}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      <Card className={data?.currentConfig.useMock ? "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30" : "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30"}>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${data?.currentConfig.useMock ? "bg-amber-100 dark:bg-amber-900" : "bg-emerald-100 dark:bg-emerald-900"}`}>
                <Server className={`h-5 w-5 ${data?.currentConfig.useMock ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`} />
              </div>
              <div>
                <p className="font-medium">
                  {data?.currentConfig.useMock ? "当前为 Mock 数据模式" : "已连接领星ERP API"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {data?.currentConfig.useMock
                    ? "系统正在使用模拟数据，配置API凭证并关闭Mock后可切换为实时数据"
                    : `API Host: ${data?.currentConfig.apiHost}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {proxyData?.proxyEnabled && (
                <Badge variant="outline" className="border-blue-300 text-blue-700 bg-blue-50 dark:border-blue-700 dark:text-blue-300 dark:bg-blue-950">
                  <Network className="h-3 w-3 mr-1" />
                  代理已启用
                </Badge>
              )}
              {data?.envHasCredentials && (
                <Badge variant="outline" className="border-blue-300 text-blue-700 bg-blue-50 dark:border-blue-700 dark:text-blue-300 dark:bg-blue-950">
                  环境变量已配置
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* API Credentials */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4 text-blue-500" />
            领星ERP开放API凭证
          </CardTitle>
          <CardDescription>
            在领星ERP后台获取开放API的App ID和App Secret。
            <a href="https://apidoc.lingxing.com" target="_blank" rel="noopener" className="text-blue-600 hover:underline ml-1">
              领星开放API文档 <ExternalLink className="inline h-3 w-3" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>App ID</Label>
              <Input
                placeholder="输入领星App ID"
                value={form.appId}
                onChange={e => setForm(f => ({ ...f, appId: e.target.value }))}
              />
            </div>
            <div>
              <Label>App Secret</Label>
              <Input
                type="password"
                placeholder="输入领星App Secret"
                value={form.appSecret}
                onChange={e => setForm(f => ({ ...f, appSecret: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <Label>API Host</Label>
            <Input
              placeholder="https://openapi.lingxing.com"
              value={form.apiHost}
              onChange={e => setForm(f => ({ ...f, apiHost: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground mt-1">默认为 https://openapi.lingxing.com，一般无需修改</p>
          </div>
        </CardContent>
      </Card>

      {/* Mock Mode Toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TestTube2 className="h-4 w-4 text-amber-500" />
            数据模式
          </CardTitle>
          <CardDescription>开启Mock模式后系统将使用模拟数据，无需真实API凭证</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div>
              <p className="font-medium">Mock数据模式</p>
              <p className="text-sm text-muted-foreground">
                {form.useMock ? "当前使用模拟数据" : "当前使用真实API数据"}
              </p>
            </div>
            <Button
              variant={form.useMock ? "outline" : "default"}
              size="sm"
              onClick={() => setForm(f => ({ ...f, useMock: !f.useMock }))}
            >
              {form.useMock ? "切换为实时数据" : "切换为Mock模式"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ═══════════════════ Lingxing API Proxy Config ═══════════════════ */}
      <Card className="border-blue-200 dark:border-blue-800">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Network className="h-4 w-4 text-blue-500" />
            领星API代理配置
            {proxyEnabled && (
              <Badge variant="default" className="ml-2 text-xs bg-blue-500">
                <Wifi className="h-3 w-3 mr-1" /> 已启用
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            配置HTTP/SOCKS5代理，让所有领星API请求通过固定IP的代理服务器转发，解决IP白名单不稳定的问题。
            此代理仅用于领星API调用，与爬虫代理独立配置。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Enable Toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-3">
              {proxyEnabled ? (
                <Wifi className="h-5 w-5 text-blue-500" />
              ) : (
                <WifiOff className="h-5 w-5 text-muted-foreground" />
              )}
              <div>
                <p className="font-medium text-sm">API代理转发</p>
                <p className="text-xs text-muted-foreground">
                  {proxyEnabled
                    ? "所有领星API请求将通过代理服务器转发"
                    : "领星API请求将直接从服务器发出"}
                </p>
              </div>
            </div>
            <Button
              variant={proxyEnabled ? "default" : "outline"}
              size="sm"
              onClick={() => {
                const newVal = proxyEnabled ? "false" : "true";
                setProxyForm(f => ({ ...f, [LX_KEYS.ENABLED]: newVal }));
              }}
            >
              {proxyEnabled ? (
                <><CheckCircle2 className="h-4 w-4 mr-1" /> 已启用</>
              ) : (
                <><XCircle className="h-4 w-4 mr-1" /> 未启用</>
              )}
            </Button>
          </div>

          {/* Proxy URL (direct) */}
          <div>
            <Label>完整代理URL（可选，优先使用）</Label>
            <Input
              placeholder="例如: http://user:pass@your-proxy.com:8080 或 socks5://user:pass@proxy:1080"
              value={proxyForm[LX_KEYS.URL] || ""}
              onChange={e => setProxyForm(f => ({ ...f, [LX_KEYS.URL]: e.target.value }))}
              disabled={!proxyEnabled}
            />
            <p className="text-xs text-muted-foreground mt-1">如果填写了完整URL，下方的分项配置将被忽略</p>
          </div>

          {/* Component fields */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>协议</Label>
              <Select
                value={proxyForm[LX_KEYS.PROTOCOL] || "http"}
                onValueChange={v => setProxyForm(f => ({ ...f, [LX_KEYS.PROTOCOL]: v }))}
                disabled={!proxyEnabled}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="https">HTTPS</SelectItem>
                  <SelectItem value="socks5">SOCKS5</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>主机地址</Label>
              <Input
                placeholder="proxy.example.com"
                value={proxyForm[LX_KEYS.HOST] || ""}
                onChange={e => setProxyForm(f => ({ ...f, [LX_KEYS.HOST]: e.target.value }))}
                disabled={!proxyEnabled}
              />
            </div>
            <div>
              <Label>端口</Label>
              <Input
                placeholder="8080"
                value={proxyForm[LX_KEYS.PORT] || ""}
                onChange={e => setProxyForm(f => ({ ...f, [LX_KEYS.PORT]: e.target.value }))}
                disabled={!proxyEnabled}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>用户名（可选）</Label>
              <Input
                placeholder="代理用户名"
                value={proxyForm[LX_KEYS.USERNAME] || ""}
                onChange={e => setProxyForm(f => ({ ...f, [LX_KEYS.USERNAME]: e.target.value }))}
                disabled={!proxyEnabled}
              />
            </div>
            <div>
              <Label>密码（可选）</Label>
              <Input
                type="password"
                placeholder="代理密码"
                value={proxyForm[LX_KEYS.PASSWORD] || ""}
                onChange={e => setProxyForm(f => ({ ...f, [LX_KEYS.PASSWORD]: e.target.value }))}
                disabled={!proxyEnabled}
              />
            </div>
          </div>

          {/* Proxy actions */}
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleSaveProxy} disabled={updateProxyMut.isPending} size="sm">
              {updateProxyMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
              保存代理配置
            </Button>
            <Button variant="outline" onClick={handleTestProxy} disabled={testProxyMut.isPending || !proxyEnabled} size="sm">
              {testProxyMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Network className="h-4 w-4 mr-1" />}
              测试代理连接
            </Button>
          </div>

          {/* Proxy test result */}
          {testProxyMut.data && (
            <div className={`p-3 rounded-lg border ${testProxyMut.data.success ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30" : "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30"}`}>
              <div className="flex items-center gap-2">
                {testProxyMut.data.success ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                )}
                <span className="text-sm">{testProxyMut.data.message}</span>
                {testProxyMut.data.latency != null && (
                  <span className="text-xs text-muted-foreground ml-auto">延迟: {testProxyMut.data.latency}ms</span>
                )}
              </div>
            </div>
          )}

          {/* Help */}
          <div className="p-3 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900">
            <p className="text-xs text-blue-700 dark:text-blue-300 font-medium mb-1">使用说明</p>
            <ul className="text-xs text-blue-600/80 dark:text-blue-400/80 space-y-0.5 ml-4 list-disc">
              <li>在领星ERP后台将代理服务器的出口IP加入API白名单</li>
              <li>支持HTTP/HTTPS/SOCKS5三种代理协议</li>
              <li>代理配置保存后立即生效，Token会自动重新获取</li>
              <li>建议使用固定IP的代理服务器，避免IP频繁变化导致白名单失效</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={updateMut.isPending} className="gap-2">
          {updateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          保存API配置
        </Button>
        <Button variant="outline" onClick={handleTest} disabled={testMut.isPending} className="gap-2">
          {testMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}
          测试API连接
        </Button>
        <Button variant="ghost" onClick={() => refetchLogs()} size="sm" className="gap-1 ml-auto">
          <Activity className="h-4 w-4" />
          刷新日志
        </Button>
      </div>

      {/* Test Result */}
      {testMut.data && (
        <Card className={testMut.data.success ? "border-emerald-200 dark:border-emerald-800" : "border-red-200 dark:border-red-800"}>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              {testMut.data.success ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
              )}
              <div className="flex-1">
                <p className={`font-medium ${testMut.data.success ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                  {testMut.data.message}
                </p>
                <div className="flex items-center gap-3 mt-1">
                  {testMut.data.latency && (
                    <span className="text-sm text-muted-foreground">响应时间: {testMut.data.latency}ms</span>
                  )}
                  {"usedProxy" in testMut.data && testMut.data.usedProxy && (
                    <Badge variant="outline" className="text-xs">
                      <Network className="h-3 w-3 mr-1" /> 通过代理
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* API Call Logs */}
      {logsData && logsData.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              最近API调用日志
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-60 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b">
                    <th className="text-left py-1.5 px-2 font-medium">时间</th>
                    <th className="text-left py-1.5 px-2 font-medium">接口</th>
                    <th className="text-left py-1.5 px-2 font-medium">状态</th>
                    <th className="text-left py-1.5 px-2 font-medium">耗时</th>
                    <th className="text-left py-1.5 px-2 font-medium">模式</th>
                  </tr>
                </thead>
                <tbody>
                  {logsData.slice().reverse().map((log, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-1.5 px-2 text-muted-foreground">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-1.5 px-2 font-mono truncate max-w-[200px]" title={log.endpoint}>
                        {log.endpoint.split("/").slice(-2).join("/")}
                      </td>
                      <td className="py-1.5 px-2">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                          log.statusCode === "200" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" :
                          log.statusCode === "ERROR" ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
                          "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                        }`}>
                          {log.statusCode}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-muted-foreground">{log.duration}ms</td>
                      <td className="py-1.5 px-2">
                        <div className="flex items-center gap-1">
                          {log.isMock ? (
                            <Badge variant="outline" className="text-[10px] px-1 py-0">Mock</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300">Real</Badge>
                          )}
                          {log.usedProxy && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300">
                              <Network className="h-2.5 w-2.5 mr-0.5" />P
                            </Badge>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Help Info */}
      <Card>
        <CardContent className="pt-5">
          <div className="space-y-3">
            <p className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              配置说明
            </p>
            <ul className="text-xs text-muted-foreground space-y-1 ml-6 list-disc">
              <li>领星ERP开放API需要在领星后台开通，并将服务器IP加入白名单</li>
              <li><strong>推荐方案：</strong>配置固定IP代理，将代理出口IP加入领星白名单，彻底解决IP不稳定问题</li>
              <li>App ID和App Secret可在领星后台「开放API」菜单中获取</li>
              <li>配置保存后会立即生效，无需重启服务</li>
              <li>如果API连接失败，系统会自动降级为Mock数据模式</li>
              <li>Mock模式下所有数据为模拟数据，仅供功能演示和测试使用</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
