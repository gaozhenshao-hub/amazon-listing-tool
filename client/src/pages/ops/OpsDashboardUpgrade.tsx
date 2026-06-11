import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Calendar, ShieldCheck, AlertTriangle, Sparkles, Zap,
  Tag, Clock, TrendingUp, TrendingDown, ChevronLeft, ChevronRight,
  RefreshCw, Loader2, CheckCircle, XCircle, Info
} from "lucide-react";

// Simple calendar view for promotions
function PromotionCalendar({ events }: { events: any[] }) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();

  const monthEvents = useMemo(() => {
    return events.filter(e => {
      const start = new Date(e.startTime);
      const end = new Date(e.endTime);
      return (start.getMonth() === month && start.getFullYear() === year) ||
             (end.getMonth() === month && end.getFullYear() === year);
    });
  }, [events, month, year]);

  const getEventsForDay = (day: number) => {
    const date = new Date(year, month, day);
    return monthEvents.filter(e => {
      const start = new Date(e.startTime);
      const end = new Date(e.endTime);
      return date >= new Date(start.toDateString()) && date <= new Date(end.toDateString());
    });
  };

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="sm" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
        <span className="font-semibold text-lg">{year}年{month + 1}月</span>
        <Button variant="ghost" size="sm" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {weekDays.map(d => (
          <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
        ))}
        {Array.from({ length: firstDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} className="h-20" />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dayEvents = getEventsForDay(day);
          const isToday = new Date().getDate() === day && new Date().getMonth() === month && new Date().getFullYear() === year;
          return (
            <div key={day} className={`h-20 border rounded-md p-1 text-xs overflow-hidden ${isToday ? 'border-primary bg-primary/5' : 'border-border'}`}>
              <div className={`font-medium mb-0.5 ${isToday ? 'text-primary' : ''}`}>{day}</div>
              {dayEvents.slice(0, 2).map((e, idx) => (
                <div key={idx} className={`truncate px-1 py-0.5 rounded text-[10px] mb-0.5 ${
                  e.type === 'deal' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
                  'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                }`}>
                  {e.type === 'deal' ? '⚡' : '🎟️'} {e.asin?.slice(-4)}
                </div>
              ))}
              {dayEvents.length > 2 && (
                <div className="text-[10px] text-muted-foreground">+{dayEvents.length - 2}更多</div>
              )}
            </div>
          );
        })}
      </div>
      {/* Event list */}
      <div className="mt-4 space-y-2">
        <h4 className="font-medium text-sm">本月活动 ({monthEvents.length})</h4>
        {monthEvents.length === 0 && <p className="text-sm text-muted-foreground">暂无促销活动</p>}
        {monthEvents.slice(0, 8).map((e, i) => (
          <div key={i} className="flex items-center gap-3 p-2 rounded-lg border text-sm">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              e.type === 'deal' ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30' : 'bg-green-100 text-green-600 dark:bg-green-900/30'
            }`}>
              {e.type === 'deal' ? <Zap className="h-4 w-4" /> : <Tag className="h-4 w-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{e.title}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Clock className="h-3 w-3" />
                {new Date(e.startTime).toLocaleDateString()} - {new Date(e.endTime).toLocaleDateString()}
              </div>
            </div>
            <Badge variant={e.status === 'ACTIVE' ? 'default' : e.status === 'UPCOMING' || e.status === 'SCHEDULED' ? 'secondary' : 'outline'}>
              {e.status === 'ACTIVE' ? '进行中' : e.status === 'UPCOMING' || e.status === 'SCHEDULED' ? '待开始' : e.status === 'EXPIRED' ? '已结束' : e.status}
            </Badge>
            {e.type === 'deal' && e.dealPrice && (
              <span className="text-xs font-medium text-orange-600">${e.dealPrice}</span>
            )}
            {e.type === 'coupon' && e.discountValue && (
              <span className="text-xs font-medium text-green-600">
                {e.subType === 'PERCENTAGE' ? `${e.discountValue}%` : `$${e.discountValue}`}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Shop Health Score Card
function ShopHealthCard({ data }: { data: any }) {
  const scoreColor = data.level === 'excellent' ? 'text-green-500' :
    data.level === 'good' ? 'text-blue-500' :
    data.level === 'warning' ? 'text-yellow-500' : 'text-red-500';
  const scoreBg = data.level === 'excellent' ? 'bg-green-500' :
    data.level === 'good' ? 'bg-blue-500' :
    data.level === 'warning' ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-6">
        <div className="relative w-28 h-28">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/20" />
            <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="8"
              className={scoreColor}
              strokeDasharray={`${data.score * 2.64} 264`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-2xl font-bold ${scoreColor}`}>{data.score}</span>
            <span className="text-xs text-muted-foreground">健康分</span>
          </div>
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${scoreBg}`} />
            <span className="font-medium">
              {data.level === 'excellent' ? '优秀' : data.level === 'good' ? '良好' : data.level === 'warning' ? '需关注' : '危险'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>订单缺陷率: <span className={data.metrics.orderDefectRate > 1 ? 'text-red-500 font-medium' : ''}>{data.metrics.orderDefectRate}%</span></div>
            <div>迟发率: <span className={data.metrics.lateShipmentRate > 4 ? 'text-red-500 font-medium' : ''}>{data.metrics.lateShipmentRate}%</span></div>
            <div>取消率: <span className={data.metrics.cancellationRate > 2.5 ? 'text-red-500 font-medium' : ''}>{data.metrics.cancellationRate}%</span></div>
            <div>有效追踪率: <span className={data.metrics.validTrackingRate < 95 ? 'text-red-500 font-medium' : ''}>{data.metrics.validTrackingRate}%</span></div>
          </div>
        </div>
      </div>
      {data.riskItems.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-red-500 flex items-center gap-1"><AlertTriangle className="h-4 w-4" /> 风险项</h4>
          {data.riskItems.map((r: any, i: number) => (
            <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-red-50 dark:bg-red-900/10 text-sm">
              <span>{r.metric}</span>
              <div className="flex items-center gap-2">
                <span className="text-red-600 font-medium">{r.value}</span>
                <span className="text-muted-foreground">阈值: {r.threshold}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OpsDashboardUpgrade() {
  const [marketplace] = useState('US');

  const calendarQuery = trpc.dashboardUpgrade.getPromotionCalendar.useQuery({ sid: undefined });
  const healthQuery = trpc.dashboardUpgrade.getShopHealth.useQuery({});
  const alertsQuery = trpc.dashboardUpgrade.getAlertsList.useQuery({ marketplace });
  const briefingMutation = trpc.dashboardUpgrade.aiDailyBriefing.useMutation();

  const handleGenerateBriefing = () => {
    briefingMutation.mutate({ marketplace });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            运营仪表盘Pro
          </h2>
          <p className="text-muted-foreground mt-1">促销日历 · 店铺健康 · 智能预警 · AI简报</p>
        </div>
        <Button onClick={handleGenerateBriefing} disabled={briefingMutation.isPending}>
          {briefingMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
          生成AI简报
        </Button>
      </div>

      {/* AI Briefing Card */}
      {briefingMutation.data && (
        <Card className="border-primary/30 bg-gradient-to-r from-primary/5 to-transparent">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI每日运营简报 — {briefingMutation.data.date}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: '销售', text: briefingMutation.data.salesSummary, icon: TrendingUp, color: 'text-blue-500' },
                { label: '广告', text: briefingMutation.data.adSummary, icon: Zap, color: 'text-orange-500' },
                { label: '库存', text: briefingMutation.data.inventorySummary, icon: Info, color: 'text-green-500' },
                { label: '退货', text: briefingMutation.data.returnSummary, icon: AlertTriangle, color: 'text-red-500' },
              ].map((item, i) => (
                <div key={i} className="p-3 rounded-lg bg-background border">
                  <div className={`text-xs font-medium ${item.color} flex items-center gap-1 mb-1`}>
                    <item.icon className="h-3 w-3" />{item.label}
                  </div>
                  <p className="text-sm">{item.text}</p>
                </div>
              ))}
            </div>
            {briefingMutation.data.priorityActions?.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">今日优先事项</h4>
                <div className="space-y-1">
                  {briefingMutation.data.priorityActions.map((a: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-sm p-2 rounded bg-muted/50">
                      <Badge variant={a.priority === 'P0' ? 'destructive' : a.priority === 'P1' ? 'default' : 'secondary'} className="text-xs">
                        {a.priority}
                      </Badge>
                      <span className="flex-1">{a.action}</span>
                      <span className="text-xs text-muted-foreground">{a.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              {briefingMutation.data.opportunities?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-green-600 mb-1">机会点</h4>
                  {briefingMutation.data.opportunities.map((o: string, i: number) => (
                    <div key={i} className="text-sm flex items-start gap-1"><CheckCircle className="h-3 w-3 mt-1 text-green-500 shrink-0" />{o}</div>
                  ))}
                </div>
              )}
              {briefingMutation.data.risks?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-red-600 mb-1">风险点</h4>
                  {briefingMutation.data.risks.map((r: string, i: number) => (
                    <div key={i} className="text-sm flex items-start gap-1"><XCircle className="h-3 w-3 mt-1 text-red-500 shrink-0" />{r}</div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="calendar">
        <TabsList>
          <TabsTrigger value="calendar"><Calendar className="h-4 w-4 mr-1" />促销日历</TabsTrigger>
          <TabsTrigger value="health"><ShieldCheck className="h-4 w-4 mr-1" />店铺健康</TabsTrigger>
          <TabsTrigger value="alerts"><AlertTriangle className="h-4 w-4 mr-1" />智能预警</TabsTrigger>
        </TabsList>

        <TabsContent value="calendar">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                促销活动日历
                {calendarQuery.data && (
                  <span className="text-sm font-normal text-muted-foreground">
                    秒杀 {calendarQuery.data.dealCount} · 优惠券 {calendarQuery.data.couponCount}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {calendarQuery.isLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
              ) : calendarQuery.data ? (
                <PromotionCalendar events={calendarQuery.data.events} />
              ) : (
                <p className="text-muted-foreground text-center py-8">暂无数据</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="health">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                店铺健康度
              </CardTitle>
            </CardHeader>
            <CardContent>
              {healthQuery.isLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
              ) : healthQuery.data ? (
                <ShopHealthCard data={healthQuery.data} />
              ) : (
                <p className="text-muted-foreground text-center py-8">暂无数据</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts">
          <div className="space-y-4">
            {/* Low Stock Alerts */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-orange-600">
                  <AlertTriangle className="h-5 w-5" />
                  库存预警
                  {alertsQuery.data && <Badge variant="outline">{alertsQuery.data.lowStockAlerts.length}</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {alertsQuery.isLoading ? (
                  <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : alertsQuery.data?.lowStockAlerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">暂无库存预警</p>
                ) : (
                  <div className="space-y-2">
                    {alertsQuery.data?.lowStockAlerts.map((a: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                        <div className="flex items-center gap-3">
                          <Badge variant={a.severity === 'critical' ? 'destructive' : 'default'}>
                            {a.severity === 'critical' ? '紧急' : '警告'}
                          </Badge>
                          <div>
                            <div className="font-medium text-sm">{a.asin}</div>
                            <div className="text-xs text-muted-foreground">{a.sku}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-orange-600">{a.daysOfSupply}天</div>
                          <div className="text-xs text-muted-foreground">库存{a.quantity}件</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Return Rate Alerts */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-600">
                  <TrendingDown className="h-5 w-5" />
                  退货率异常
                  {alertsQuery.data && <Badge variant="outline">{alertsQuery.data.returnAlerts.length}</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {alertsQuery.isLoading ? (
                  <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : alertsQuery.data?.returnAlerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">暂无退货率异常</p>
                ) : (
                  <div className="space-y-2">
                    {alertsQuery.data?.returnAlerts.map((a: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                        <div className="flex items-center gap-3">
                          <Badge variant={a.severity === 'critical' ? 'destructive' : 'default'}>
                            {a.severity === 'critical' ? '严重' : '偏高'}
                          </Badge>
                          <div>
                            <div className="font-medium text-sm">{a.asin}</div>
                            <div className="text-xs text-muted-foreground">{a.title}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-red-600">{a.returnRate}%</div>
                          <div className="text-xs text-muted-foreground">退货{a.returnCount}件</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
