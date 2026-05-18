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
  Users,
  Trash2,
  ArrowRight,
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

// Lingxing proxy keys removed - API integration deprecated

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
        <p className="text-muted-foreground mt-1">管理代理配置、爬虫策略和系统设置</p>
      </div>

      <Tabs defaultValue="nextsls" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="nextsls" className="flex items-center gap-2">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
            物流API
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
          <TabsTrigger value="mapping" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            人员映射
          </TabsTrigger>
        </TabsList>

        {/* ═══════════════════ NextSLS Logistics API Tab ═══════════════════ */}
        <TabsContent value="nextsls" className="space-y-6">
          <NextSlsSettings />
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

        {/* Operator Name Mapping Tab */}
        <TabsContent value="mapping" className="space-y-6">
          <OperatorMappingSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// LingxingApiSettings component removed - Lingxing API integration deprecated
// Data is now imported via Excel uploads

function _LingxingApiSettingsRemoved() { return null; }



// ═══════════════════════════════════════════════════════════════════════
// NextSLS Logistics API Settings Component
// ═══════════════════════════════════════════════════════════════════════

function NextSlsSettings() {
  const { data, isLoading, refetch } = trpc.logistics.getConfig.useQuery();
  const saveMut = trpc.logistics.saveConfig.useMutation({
    onSuccess: () => { toast.success("物流API配置已保存"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const testMut = trpc.logistics.testConnection.useMutation();
  const { data: logsData, refetch: refetchLogs } = trpc.logistics.getApiLogs.useQuery({ limit: 15 });

  const [form, setForm] = useState({
    baseUrl: "",
    token: "",
    enabled: false,
  });
  const [initialized, setInitialized] = useState(false);

  React.useEffect(() => {
    if (data && !initialized) {
      setForm({
        baseUrl: data.baseUrl || "https://zjyxgj.nextsls.com",
        token: data.token || "",
        enabled: data.enabled,
      });
      setInitialized(true);
    }
  }, [data, initialized]);

  const handleSave = () => {
    saveMut.mutate({
      baseUrl: form.baseUrl || undefined,
      token: form.token || undefined,
      enabled: form.enabled,
    });
  };

  const handleTest = () => {
    testMut.mutate();
  };

  if (isLoading) {
    return <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />)}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      <Card className={data?.isReady
        ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30"
        : "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30"
      }>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${data?.isReady ? "bg-emerald-100 dark:bg-emerald-900" : "bg-amber-100 dark:bg-amber-900"}`}>
                <svg className={`h-5 w-5 ${data?.isReady ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </div>
              <div>
                <p className="font-medium">
                  {data?.isReady ? "已连接知己云星管家物流API" : "物流API未配置"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {data?.isReady
                    ? "物流时效数据将自动反哺库存预警模块，提升补货预测准确性"
                    : "配置API凭证后可获取真实物流时效数据，优化库存预警精度"}
                </p>
              </div>
            </div>
            {data?.isReady && (
              <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:bg-emerald-950">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                已就绪
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Data Flow Diagram */}
      <Card className="border-blue-100 dark:border-blue-900">
        <CardContent className="pt-5 pb-4">
          <p className="text-sm font-medium mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-500" />
            数据流向：物流时效 → 库存预警
          </p>
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="px-2.5 py-1.5 rounded-lg bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium">
              NextSLS运单轨迹
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="px-2.5 py-1.5 rounded-lg bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 font-medium">
              物流时效统计
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="px-2.5 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 font-medium">
              补货引擎·头程天数
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="px-2.5 py-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 font-medium">
              库存预警·断货/补货建议
            </span>
          </div>
        </CardContent>
      </Card>

      {/* API Credentials */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4 text-blue-500" />
            知己云星管家 API 凭证
          </CardTitle>
          <CardDescription>
            配置NextSLS物流API的网站地址和Token。
            <a href="https://zjyxgj.nextsls.com/api/v5/docs" target="_blank" rel="noopener" className="text-blue-600 hover:underline ml-1">
              API文档 <ExternalLink className="inline h-3 w-3" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>API 网站地址</Label>
            <Input
              placeholder="https://zjyxgj.nextsls.com"
              value={form.baseUrl}
              onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground mt-1">物流公司提供的API网站地址</p>
          </div>
          <div>
            <Label>API Token</Label>
            <Input
              type="password"
              placeholder="输入物流API Token"
              value={form.token}
              onChange={e => setForm(f => ({ ...f, token: e.target.value }))}
            />
            {form.token === "••••••••" && (
              <p className="text-xs text-muted-foreground mt-1">已配置（显示为掩码），如需修改请清空后重新输入</p>
            )}
          </div>

          {/* Enable Toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div>
              <p className="font-medium text-sm">启用物流API</p>
              <p className="text-xs text-muted-foreground">
                {form.enabled ? "物流时效数据将自动同步并反哺库存预警" : "启用后将自动获取物流时效数据"}
              </p>
            </div>
            <Button
              variant={form.enabled ? "default" : "outline"}
              size="sm"
              onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
            >
              {form.enabled ? (
                <><CheckCircle2 className="h-4 w-4 mr-1" /> 已启用</>
              ) : (
                <><XCircle className="h-4 w-4 mr-1" /> 未启用</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saveMut.isPending} className="gap-2">
          {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          保存配置
        </Button>
        <Button variant="outline" onClick={handleTest} disabled={testMut.isPending} className="gap-2">
          {testMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}
          测试连接
        </Button>
        {logsData && logsData.length > 0 && (
          <Button variant="ghost" onClick={() => refetchLogs()} size="sm" className="gap-1 ml-auto">
            <Activity className="h-4 w-4" />
            刷新日志
          </Button>
        )}
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
                {(testMut.data as any).latency && (
                  <span className="text-sm text-muted-foreground">响应时间: {(testMut.data as any).latency}ms</span>
                )}
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
            <div className="max-h-48 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b">
                    <th className="text-left py-1.5 px-2 font-medium">时间</th>
                    <th className="text-left py-1.5 px-2 font-medium">接口</th>
                    <th className="text-left py-1.5 px-2 font-medium">状态</th>
                    <th className="text-left py-1.5 px-2 font-medium">耗时</th>
                  </tr>
                </thead>
                <tbody>
                  {logsData.slice().reverse().map((log: any, i: number) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-1.5 px-2 text-muted-foreground">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-1.5 px-2 font-mono truncate max-w-[200px]" title={log.endpoint}>
                        {log.endpoint}
                      </td>
                      <td className="py-1.5 px-2">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                          log.success ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" :
                          "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                        }`}>
                          {log.success ? "OK" : "FAIL"}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-muted-foreground">{log.duration}ms</td>
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
              功能说明
            </p>
            <ul className="text-xs text-muted-foreground space-y-1 ml-6 list-disc">
              <li><strong>物流时效统计：</strong>自动从NextSLS历史运单中提取各节点时间，按渠道/目的国计算平均头程天数</li>
              <li><strong>库存预警联动：</strong>补货建议中的"头程运输天数"将优先使用NextSLS真实时效数据，替代默认估算值</li>
              <li><strong>断货预警优化：</strong>基于真实物流轨迹动态计算在途货物的预计到货时间</li>
              <li><strong>运单状态同步：</strong>物流批次管理页面可自动同步NextSLS运单状态和轨迹</li>
              <li>配置保存后立即生效，无需重启服务</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════
// Operator Name Mapping Settings Component
// ═══════════════════════════════════════════════════════════════════════

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function OperatorMappingSettings() {
  const { data: mappings, isLoading, refetch } = trpc.operatorMapping.listMappings.useQuery();
  const deleteMut = trpc.operatorMapping.deleteMapping.useMutation({
    onSuccess: () => {
      toast.success("映射已删除");
      refetch();
    },
    onError: (err) => toast.error("删除失败", { description: err.message }),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            运营人员名称映射管理
          </CardTitle>
          <CardDescription>
            管理领星/赛狐导出数据中的运营人员名称与系统用户之间的映射关系。
            导入数据时系统会自动匹配，未匹配的名称会弹出确认弹窗。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !mappings?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>暂无映射记录</p>
              <p className="text-sm mt-1">导入数据时会自动创建映射关系</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>导出名称（外部）</TableHead>
                    <TableHead className="w-[40px]"></TableHead>
                    <TableHead>系统用户名</TableHead>
                    <TableHead>数据来源</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.externalName}</TableCell>
                      <TableCell>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                      <TableCell>
                        {m.systemUserName ? (
                          <span className="text-green-700 dark:text-green-300 font-medium">
                            {m.systemUserName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">未映射</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={
                          m.sourceType === "lingxing"
                            ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800"
                            : m.sourceType === "saihu"
                            ? "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800"
                            : ""
                        }>
                          {m.sourceType === "lingxing" ? "领星" : m.sourceType === "saihu" ? "赛狐" : "通用"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {m.isConfirmed ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            已确认
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-800">
                            待确认
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {m.createdAt ? new Date(m.createdAt).toLocaleDateString("zh-CN") : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm("确定删除此映射关系？删除后下次导入需要重新确认。")) {
                              deleteMut.mutate({ id: m.id });
                            }
                          }}
                          disabled={deleteMut.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tips */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">使用说明</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            <strong>自动匹配：</strong>每次导入Excel数据时，系统会自动从导出的运营人员名称中提取核心名称，
            与系统用户进行模糊匹配。匹配度高于80%的会自动建议，低于80%的需要手动确认。
          </p>
          <p>
            <strong>映射记忆：</strong>确认过的映射关系会被记住，下次导入相同名称时自动使用已确认的映射，无需重复确认。
          </p>
          <p>
            <strong>名称提取规则：</strong>系统会自动去除导出名称中的前缀（如"运营"）和后缀标签（如"_XM-1"），
            提取核心中文名或英文名进行匹配。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
