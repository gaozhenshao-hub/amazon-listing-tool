# 历史项目工作空间归属回填记录

**执行时间：** 2026-08-20 08:37（Asia/Shanghai）  
**目的：** 修复历史项目`workspaceId`为空时，同工作空间的`designer`角色无法通过项目列表读取项目、进而无法查看智能图片建议的问题。

## 回填依据与边界

回填前只读审计发现 **28** 个项目的`workspaceId`为空。所有项目的创建者均存在，且其`defaultWorkspaceId`均为 **1**，因此使用创建者默认工作空间作为唯一、无歧义的回填依据。执行后，项目表中`workspaceId IS NULL`的记录数为 **0**。

> 本次为数据归属修复，不改变项目创建者、项目内容、角色定义或二级模块操作权限。

## 受影响项目清单

| 项目ID | 项目名称 | 创建者用户ID | 回填前 | 回填后 |
|---:|---|---:|---|---:|
| 60002 | 减压阀 | 270035 | NULL | 1 |
| 120002 | 商厨管 | 270010 | NULL | 1 |
| 150001 | Bread Slicer | 270022 | NULL | 1 |
| 180001 | 3合1狗坡道 | 270035 | NULL | 1 |
| 210001 | 脏辫机 | 270028 | NULL | 1 |
| 240001 | 狗绳玩具 | 270025 | NULL | 1 |
| 270001 | W10898445 Refrigerator Ice Level Control emitter and receiver LED light board | 270025 | NULL | 1 |
| 300001 | BAC772烤盘 | 270035 | NULL | 1 |
| 330001 | 7-in-1 Complete Battery PPE Kit | 270025 | NULL | 1 |
| 330002 | Large Rolling Cleaning Caddy Bag with Detachable Trolley, Cleaning Cart on Wheels with Shoulder Strap | 270025 | NULL | 1 |
| 360001 | Dental Intraoral Cheek Lip Retractor | 270025 | NULL | 1 |
| 390001 | Electric Scissor Lift Table 440LBS | 270025 | NULL | 1 |
| 420001 | 6320241静音鼓风机 | 270035 | NULL | 1 |
| 420002 | DD82-01384A洗碗机筐子 | 270028 | NULL | 1 |
| 450001 | 隐藏式墙内保险箱 | 270028 | NULL | 1 |
| 480001 | 焊枪 | 1 | NULL | 1 |
| 510001 | 养蜂服 listing优化 | 20 | NULL | 1 |
| 540001 | 牙医填充套件 | 270035 | NULL | 1 |
| 570001 | 焊片 | 20 | NULL | 1 |
| 600001 | 宠物吸痰机 | 270035 | NULL | 1 |
| 630001 | rm500 | 20 | NULL | 1 |
| 660001 | LABEL REWINDER | 270025 | NULL | 1 |
| 690001 | 小型裁纸刀 | 270035 | NULL | 1 |
| 720001 | 车用挡狗门 | 270035 | NULL | 1 |
| 750001 | 替换滤芯 | 270022 | NULL | 1 |
| 780001 | 狗爬梯带护栏 | 270035 | NULL | 1 |
| 840001 | ICM289电路板 | 270025 | NULL | 1 |
| 870001 | AKK益生菌 | 270025 | NULL | 1 |

## 验收状态

空气套件（项目`90001`）已作为真实图片建议页面样本：临时`designer`会话可在同工作空间加载完整Step5历史结果，且只显示查看与导出能力。后续仍应在多个非空气套件项目上抽样验证项目列表和只读访问范围。
