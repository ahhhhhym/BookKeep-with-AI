# 分类稳定ID与本地图标规格

版本：S03-1.0｜2026-10-20｜作者：Codex｜状态：文档自查完成，待S04接收

依据：[PRD §4.2](PRD.md)、[架构分类域](ARCHITECTURE.md)、参考图2（已查看）。本文件定义种子数据和语义，不是图标源码/运行时白名单。DSH在S04锁定图标依赖并本地打包，S05落种子；不裁切参考图，不热链CDN，不使用emoji代替生产分类图标。

## 1. 身份与许可

采用Lucide SVG图标，作为随应用离线分发的本地资源。2026-10-20实际读取[官方许可](https://lucide.dev/license)与[上游LICENSE](https://raw.githubusercontent.com/lucide-icons/lucide/main/LICENSE)：主体为ISC，包含Feather衍生图标的MIT条款。DSH须随锁定版本保存完整原文（两个部分及版权声明），在应用/源码ZIP的第三方许可中提供；不要仅标“免费”。本步只选择资源方案和语义，没有下载生产SVG、安装依赖或编写图标组件。S04必须记录实际包版本/来源commit/许可文件hash，逐项验证下列slug存在，S18检查断网资源及许可入包。版本变化导致重命名时先登记映射变更，不能悄悄改持久iconKey。

Category.id按下表固定；systemKey等于id去掉`cat_`前缀，唯一(ledgerId,systemKey)播种，不能用中文名或随机UUID代替系统ID。默认enabled=true、version=1；sortOrder为下表序号×10。改名/图标/排序/停用不改id或systemKey。自定义分类主进程生成UUID，systemKey=null，初始sortOrder=350，其后按10递增；到域上限需重新排序，不溢出。用户排序不同不改变金额并列时的id ASCII升序。

iconKey固定为`lucide:<slug>`，作为本地白名单别名；Category.iconKey与Category.id分开，不把图标名称当外键。24×24坐标、2逻辑像素细线、圆角端点；界面显示20～24逻辑像素，点击目标至少36×36；图标随文字缩放，分类名常显。默认深灰线，选中浅蓝底+深蓝线并有勾选/边框，不能只靠颜色。没有图标资源时显示本地通用占位+原分类名，并报资源错误，不更改交易类别。

本步以[上游树02eb9161b57917ccaa262f1bf070507cddde3b08](https://github.com/lucide-icons/lucide/tree/02eb9161b57917ccaa262f1bf070507cddde3b08/icons)核对35个映射slug实际存在（34类+设置），未复制SVG。首次核对发现旧名称book-marked已不存在，已在落库前改用book-bookmark。S04可选覆盖本表的正式版本或本地所选SVG集，但须记录确切来源、许可与哈希；依赖包导出别名不必等于持久iconKey，适配由DSH实现且留映射，不能以图标改名为由改变分类ID。

## 2. 完整分类表（33+其他）

| 序号 | 稳定Category.id | 初始中文名 | iconKey | 图标语义/与参考图关系 |
|---|---|---|---|---|
| 1 | cat_food | 餐饮 | lucide:utensils | 餐具，吃饭支出 |
| 2 | cat_shopping | 购物 | lucide:shopping-bag | 手提购物袋 |
| 3 | cat_daily | 日用 | lucide:toilet | 卫生日用，以通用卫浴代卷纸 |
| 4 | cat_transport | 交通 | lucide:bus-front | 公交正面 |
| 5 | cat_vegetables | 蔬菜 | lucide:carrot | 胡萝卜 |
| 6 | cat_fruit | 水果 | lucide:cherry | 成对水果 |
| 7 | cat_snacks | 零食 | lucide:cupcake | 小蛋糕 |
| 8 | cat_sport | 运动 | lucide:bike | 自行车 |
| 9 | cat_entertainment | 娱乐 | lucide:mic | 麦克风 |
| 10 | cat_communication | 通讯 | lucide:phone-call | 通话声波 |
| 11 | cat_clothing | 服饰 | lucide:shirt | 衣服 |
| 12 | cat_beauty | 美容 | lucide:brush | 美容刷，文字区分画笔 |
| 13 | cat_housing | 住房 | lucide:house | 房屋轮廓 |
| 14 | cat_home | 居家 | lucide:armchair | 家居椅 |
| 15 | cat_children | 孩子 | lucide:baby | 婴孩 |
| 16 | cat_elders | 长辈 | lucide:person-standing | 长辈照顾，通用人物配文字，不描摹头像 |
| 17 | cat_social | 社交 | lucide:messages-square | 对话气泡 |
| 18 | cat_travel | 旅行 | lucide:plane | 飞机 |
| 19 | cat_tobacco_alcohol | 烟酒 | lucide:wine | 酒杯，烟酒共一类 |
| 20 | cat_digital | 数码 | lucide:cable | 数据线，维修850不归此类 |
| 21 | cat_car | 汽车 | lucide:car | 汽车 |
| 22 | cat_medical | 医疗 | lucide:briefcase-medical | 医疗箱十字 |
| 23 | cat_books | 书籍 | lucide:book-bookmark | 带书签的书 |
| 24 | cat_study | 学习 | lucide:graduation-cap | 学位帽 |
| 25 | cat_pet | 宠物 | lucide:dog | 宠物犬 |
| 26 | cat_cash_gift | 礼金 | lucide:banknote | 纸币，与实物礼物区分 |
| 27 | cat_gift | 礼物 | lucide:gift | 礼物盒 |
| 28 | cat_office | 办公 | lucide:briefcase-business | 公文包 |
| 29 | cat_repair | 维修 | lucide:hammer | 锤子，iPad维修归此类 |
| 30 | cat_donation | 捐赠 | lucide:heart-handshake | 爱心帮助 |
| 31 | cat_lottery | 彩票 | lucide:ticket | 票券 |
| 32 | cat_relatives | 亲友 | lucide:users-round | 多人，区别社交气泡 |
| 33 | cat_delivery | 快递 | lucide:package | 包裹 |
| 34 | cat_other | 其他 | lucide:ellipsis | 通用省略；只有人明确选择才归其他 |

## 3. 设置入口与维护操作

设置为导航动作`nav_settings`、iconKey=`lucide:settings`，没有Category.id/systemKey/金额，不能提交给Transaction.categoryId。分类选择弹层中与34个类别分区，末尾显示“管理分类”，进入分类页；齿轮进入设置。不能选中“设置”作为消费种类。

分类页默认按sortOrder/id排序，已停用项独立区仍可搜索及启用；旧记录/统计以当前名称和图标显示并带“已停用”，关联和金额不变。其他允许改名换图标但不可停用（按cat_other身份保护，不能靠名称识别）。新增/改名1～20码点，NFC及首尾去空白，停用类也占名；最多500类（含停用）。图标选择只允许本地白名单，不能上传SVG或任意链接。

操作验收：首次及二次初始化均34类且无设置类；逐项选择后显示对应中文及稳定ID；餐饮改名“用餐”后旧交易仍cat_food；停用后新建不可选、旧编辑未改categoryId可保留、恢复原记录可保留；cat_other停用报CATEGORY_PROTECTED；任意非法iconKey报ICON_INVALID，原数据不变。AC01/04/21/22由DSH S05/06实现、Codex S08/S17/S19验收，当前均未执行。

## 4. S04 导航资源接收补充（2026-10-20）

本机工程锁定 lucide-react/lucide-static 1.60.0；本次 build 复跑核验42/42 slug及12份第三方许可。34个分类加以下8个导航共42项；原有设置slug已计入8项，故相对原35项新增7项。分类图标白名单仍为原34项，导航slug不能成为消费分类。

| 导航 | iconKey |
|---|---|
| 记账 | lucide:notebook-pen |
| 统计 | lucide:chart-line |
| 图片导入 | lucide:image-plus |
| 任务队列 | lucide:list-checks |
| 候选审核 | lucide:clipboard-check |
| 分类 | lucide:layout-grid |
| 数据管理 | lucide:database |
| 设置 | lucide:settings |

这是资源核验，不是图标按钮的键盘/读屏/缩放交互验收；后者仍在 AC21。
