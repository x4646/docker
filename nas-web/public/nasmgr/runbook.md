# 视频省空间 / 缩略图 运行手册

最后更新：2026-09-29。页面入口：http://whfnas:3060/nasmgr/ 顶部"🎬 视频省空间向导"（按 ①→⑨ 顺序点）。本手册页面：http://whfnas:3060/nasmgr/runbook.html
给未来的自己（人或 Claude）：动视频/缩略图相关的任何东西之前，先读完"铁律"和"事故复盘"两节。

## 一、铁律（违反过，代价很大）

1. **视频的身份 key = 快速内容指纹**，存在 `photos.md5`（media_type='video'）。算法在 `services/nas-media/public/js/video-key.js`：`md5('vk1:'+大小+':'+头1MB+中1MB+尾1MB)`。不是文件名哈希，不是整份内容 md5。图片才用真实内容 md5（JPG 优先读 EXIF 里的 `NAS_MD5=` 标记，没有才整份算）。
2. **改名/搬目录不会改 key（这是设计目的）**；只有文件字节真的变了（换壳、转码、无损修复、顶替）key 才变。变的时候必须调 `vk.remapKey(db, 旧key, 新key, {path, reason})`：它会把标签/收藏/特征跟过去、缩略图文件改名、并写一条 `video_key_history`。绝对不要只改 `photos.md5` 不管关联表和缩略图。
3. **BAK 共享下的视频一律保留原文件**；其他共享，已经有 `_转码.mp4` 副本的可以用副本顶替原文件。
4. **删除类操作先验证再删**：无损修复/换壳/顶替都是先用 ffprobe 核对时长（差 >2 秒或 >2% 就放弃），再挪进回收目录，验证通过才真正删。验证没通过的旧文件保留。
5. **批量改 key 之前**：先在电脑上 Ctrl+C 停掉抽帧程序（它按 key 写缩略图），并备份数据库。页面第⑥步和 `video_key_migrate.js` 都会检查抽帧程序是否在线，在线就拒绝执行，并自动备份数据库。
6. 长任务的进度记在 nas-media 进程内存里，**进程一重启就丢**（数据库里已完成的不会丢）。所有步骤都能重复点，已处理的会跳过。不要在长任务跑着的时候改 `public/js` 下被 routes.js 加载的文件（`node --watch` 会重启进程）；worker 线程文件（`*-worker-thread.js`）改了不会重启。

## 二、数据约定

- 数据库：`/share/ssd001/nas.db`（SSD，唯一活动库）；安静 5 分钟后自动快照到 `/data/nas.db`。迁移前备份：`/share/ssd001/nas.db.before_vkey_20260929`（回滚：停 nas-media，用它覆盖 nas.db，再启动；注意会丢这之后的所有写入）。
- `photos.web_ready`：0 未处理，1 无损换壳/修复完成（网页能播），2 有损转码完成（旁边"转换/"目录里有 `_转码.mp4` 副本），-1 失败。
- `photos.shots`：>0 已抽帧张数，0 待抽帧，-1 抽帧失败（不会自动重试）。
- 转码副本路径规则：`/share/<共享>/转换/<原相对目录>/<原文件名去扩展名>_转码.mp4`；换壳副本同目录 `_换壳.mp4`。
- 回收目录（原文件先挪进这里，验证通过才删）：`.zhuanma_trash`、`.video_migrate_trash`、`.conv_replace_trash`，都在原视频所在目录下。
- 缩略图（都在 SSD `/share/ssd001/nas-thumbs/`）：`thumbs`（图片小图）、`preview`（图片预览）、`vthumbs`（视频抽帧，按 `<key前2位>/<key>_NN.jpg`，NN=01..最多10）。`/share/Container/docker/data/photos/{thumbs,preview}` 和 `services/nas-media/vthumbs` 都是指向 SSD 的软链接。
- 视频时长 <10 秒的，抽帧张数=秒数（不是10张），这是正常的。
- key 变更历史表：`video_key_history(old_key,new_key,path,reason,changed_at)`，缩略图/标记对不上时按它救。

## 三、步骤 ①→⑨（页面向导，对应后端接口和代码）

| 步 | 做什么 | 后端 | 代码 |
|---|---|---|---|
| ① 现状 | 三类数量：已能在线播放 / 能无损修 / 只能有损转码（还没转过的） | `GET /api/zhuanma/scan` | `zhuanma.js` |
| ② 无损修复 | 编码浏览器认、只是封装/时间戳坏的：`-c copy -fflags +genpts` 重新封装；原文件进 `.zhuanma_trash` | `POST /api/zhuanma/fix/start` | `zhuanma.js` |
| ③ 释放空间 | 修复/换壳只是挪走原文件，**不会腾空间**；这步验证新文件能读出时长后才删回收目录里的旧文件 | `POST /api/zhuanma/verify-and-clear`、`POST /api/video-migrate/verify-and-clear`；预览 `GET /api/video-wizard/trash-preview` | `zhuanma.js` `video-migrate.js` `video-wizard.js` |
| ④ 换壳替换 | 体检通过的用"转换/"里的换壳副本顶替原文件（先在页面下方"换壳去重体检"卡片点体检） | `POST /api/video-migrate/apply-batch`；待替换数 `GET /api/video-wizard/migrate-pending`（副本已不在的算过期，不计入） | `video-migrate.js` |
| ⑤ 转码副本顶替 | web_ready=2 且非 BAK 且副本在：核对时长+h264 后，副本顶替原文件，删原文件（不可恢复） | `POST /api/conv-replace/start`、`GET /api/conv-replace/preview` | `conv-replace.js` |
| ⑥ 统一视频 key | 全库按快速指纹重算 key，标签/标记/特征/缩略图跟着改；先备份库、要求抽帧程序已停 | `POST /api/video-wizard/key-migrate/start` | `video-wizard.js` `video-key.js`（一次性脚本版 `video_key_migrate.js`） |
| ⑦ 补缩略图 | 检查缺多少、把缺图的重置成待抽帧、看电脑程序是否在线、速度和预计完成时间 | `GET /api/video-wizard/thumb-check`、`POST /api/video-wizard/thumb-reset`、`GET /api/video-wizard/thumb-rate`、`GET /api/video/agent-status`、`GET /api/video/progress` | `video-wizard.js` `video-ext.js` |
| ⑧ 清孤立缩略图 | 文件名里的 key 已没有任何视频/照片在用的旧缩略图，等⑦补完再清 | `GET /api/video-wizard/orphan-thumbs`、`POST /api/video-wizard/orphan-thumbs/clean` | `video-wizard.js` |
| ⑨ 有损转码 | 编码浏览器不认（hevc 等）且没转过的，要电脑显卡转（VconvAgent.ps1），在"视频转换"页面做 | `/videoer/convert.html` | `video-conv.js` |
| ⑩ 检查能否在线播放 | 后台 ffprobe 逐个检查(容器/视频音频编码/10位/分辨率/读不出时长)，结果存 photos.play_check(1可播 2可能有问题 -1不能播)+play_reason；重启自动续跑；videoer 播放器据此隐藏/半亮"在线"标签 | `POST /api/video-playcheck/start`、`GET /api/video-playcheck/status`、`GET /api/video-playcheck/list?class=bad` | `video-playcheck.js` |

推荐顺序：② → ③ → ④ → ③ → ⑤ → ③(不用，⑤自带删除) → **停抽帧程序** → ⑥ → **启动抽帧程序** → ⑦ 跑完 → ⑧。

## 四、电脑上的抽帧程序 `X:\docker\pc-scripts\video_thumbs.ps1`

**一键启动 4 个窗口（推荐）**：双击 `X:\docker\pc-scripts\video_thumbs_start4.bat`，或 `powershell -NoProfile -ExecutionPolicy Bypass -File X:\docker\pc-scripts\video_thumbs_start4.ps1 [-Count 3] [-Dir "/share/..."] [-Retry]`。已经在运行的 Id 自动跳过（重复双击不会重复开）。一键全停：`video_thumbs_stop.bat`（只杀抽帧窗口及其 ffmpeg/ffprobe 子进程，不碰别的 ffmpeg）。排他靠两层：本机每个 Id 一个锁文件，服务端"任务租约"保证同一个视频 15 分钟内只发给一个窗口。以下是单个窗口的用法：

```
powershell -NoProfile -ExecutionPolicy Bypass -File X:\docker\pc-scripts\video_thumbs.ps1            # 全库
powershell -NoProfile -ExecutionPolicy Bypass -File X:\docker\pc-scripts\video_thumbs.ps1 -Dir "/share/Person/pic/well"   # 只处理某目录
powershell -NoProfile -ExecutionPolicy Bypass -File X:\docker\pc-scripts\video_thumbs.ps1 -Retry     # 连失败(-1)的一起重试
powershell -NoProfile -ExecutionPolicy Bypass -File X:\docker\pc-scripts\video_thumbs.ps1 -Id 2          # 再开一个窗口并行跑(Id 不同即可, 2/3/4...)
```
- 窗口别关，Ctrl+C 停。同一个 `-Id` 只能开一个（锁文件 `%TEMP%\VideoThumbsAgent_<Id>.lock`）；想提速就多开几个窗口，各给不同的 `-Id`（服务端有"任务租约"：领出去的视频 15 分钟内不会再发给别的窗口，不会重复干活）。实测单窗口约 6 个视频/分钟，全库 1.6 万个要两天。启动时会打印 `thumbnail output dir: \\WHFNAS\ssd001\nas-thumbs\vthumbs`。
- 流程：`GET /api/video/pending` 领任务 → ffprobe → ffmpeg 均分截 ≤10 张（`-update 1 -vf scale=320:-2`）→ `POST /api/video/meta` 回报。写图直接写 SSD 共享，不走 X: 盘。
- `.ps1` 文件必须带 **UTF-8 BOM**（含中文字符串），否则 PowerShell 5.1 按 GBK 读，乱码。
- 页面判断"在线"的依据：60 秒内有过 `/api/video/pending` 请求（`/api/video/agent-status`）。

## 五、事故复盘（现象 → 根因 → 处理）

| 现象 | 根因 | 处理 |
|---|---|---|
| 抽帧 `ALL FRAMES FAILED`，日志里没细节 | 新版 ffmpeg 输出单张 jpg 必须加 `-update 1` | 脚本已加；失败时打印 ffmpeg 输出最后 12 行 |
| 提示文字乱码 | ps1 缺 UTF-8 BOM | 已加 BOM，改脚本后要保留 |
| `frame=1 ... Conversion failed!` | vthumbs 在 NAS 上是指向 SSD 的软链接，Samba 默认不让软链接跳出共享，Windows 写不进 | 脚本直接写 `\\WHFNAS\ssd001\nas-thumbs\vthumbs` |
| 某个文件所有帧失败（`小恩雅35.mp4`，容器时长 26 小时） | 容器里写的时长是假的，均分时间点落在文件结尾之后 | 用 `文件大小×8÷各流码率` 估真实时长；再兜底截 3s/1s/0s |
| 抽帧程序在线但一个都不推进 | 领任务带 `retry=1`，队列按 id 排序，最前面 ~200 个坏文件每次都失败又排回头部，永远轮不到后面的 | 默认只领 `shots=0`，重试要显式 `-Retry` |
| 视频缩略图大面积灰块（曾 70~80%） | 换壳/无损修复等流程改了 key（zhuanma 还把 md5 覆盖成真实内容 md5），旧 key 的缩略图变孤儿；`shots` 没重置 | 统一成快速指纹 key + `remapKey`；用换壳记录把 3818 个视频的旧图改名救回；⑧清孤儿 |
| 统计"需要有损转码 3467" 虚高 | `web_ready=2`（已转码）被算成没转 | 扫描口径修正，真实待转约 2235 |
| 换壳"待替换 529"点了大半失败 | 换壳副本文件已经不在（体检记录过期） | 向导里单独标"过期"，不计入待替换 |
| 库里有 132 条视频记录但磁盘上找不到文件 | (127条) 早期一次换壳替换物理上已完成(原 `.flv` 进 `.video_migrate_trash`、`.mp4` 顶替)，但数据库更新失败(目标路径已被别的记录占用/服务重启)，旧行残留且状态仍是"体检通过"；(4条) 无损修复把原文件挪进 `.zhuanma_trash` 后被服务重启打断，修好的文件没放回原位 | 4 个原文件从 `.zhuanma_trash` 放回并校准 key；127 条旧行的标签/标记/缩略图并到对应 `.mp4` 记录后删旧行，体检记录标成 applied，再"验证并清回收目录"释放 6.2GB；1 个未登记的 `.mp4` 补登记。修复脚本思路：先核对回收目录原文件与现有 `.mp4` 时长一致再动手，动手前备份库(`nas.db.before_stalefix_20260930`) |
| 改了 `public/js` 里的文件，长任务进度消失 | `node --watch` 重启进程，内存里的任务没了 | 见铁律 6；已完成部分在库里，重点一次即可续上 |
| 备份到 PC 的逻辑折腾很久 | 备份差异按 md5 比对，EXIF 标记/后台脚本改字节导致大量误判"缺失" | 用户决定：备份用专业工具，这块不再投入 |

## 六、常用核对（在 NAS 上）

```
# 缩略图现状
docker exec nas-media node -e "const D=require('better-sqlite3');const db=new D('/share/ssd001/nas.db',{readonly:true});console.log(db.prepare(\"SELECT SUM(shots>0) done,SUM(shots=0) pending,SUM(shots=-1) failed FROM photos WHERE media_type='video'\").get())"
# 抽帧程序是否在线 / 速度
curl -s http://localhost:3050/api/video/agent-status ; curl -s http://localhost:3050/api/video-wizard/thumb-rate   (在 nas-media 容器里用 node http.get 访问同样路径)
# 某个视频的 key 变更历史
SELECT * FROM video_key_history WHERE path LIKE '%关键字%';
```

## 七、当前遗留 / 待办（2026-09-29）

- 只能有损转码且还没转的约 2235 个（hevc 等），需要电脑显卡跑 VconvAgent，未开始；转完再用步骤⑤顶替能省空间。
- 无损修不了的 74 个（文件本身损坏，时长核对不过，已自动跳过）；抽帧失败约 200 个（多为坏文件）。
- 约 70 条收藏/评分标记的旧 key 对应不上任何视频（历史遗留，需要重算内容才能救，暂未处理）；有 50 组内容相同的重复视频共用同一个 key（预期）。
- `video-migrate.js` 由另一个 Claude 会话维护（会话名"视频转化播放问题"），我只改了 key 的两处写法，改它之前先读磁盘上现在的版本。
- 视频页右键菜单"清理孤立记录"仍是没有后端的死按钮。
- 以后如果又出现"库里有记录、磁盘上没文件"：先查原文件是不是躺在 `.video_migrate_trash` / `.zhuanma_trash` / `.conv_replace_trash`（多半是操作被重启打断），能放回就放回，别直接删记录。

## 八、2026-09-29 战果

无损转码回收站清理 2.72TB + 换壳替换 76.9GB + 转码顶替 191.9GB + 缩略图/预览备份约 150GB ≈ **3.1TB**；视频缩略图约 18.7 万张靠改名救回，key 统一完成（26972 个）。

## 九、视频回收站（逻辑删除，2026-09-30）

- videoer 视频卡片右键 →"🗑 逻辑删除（放入回收站）"：只打 `pending_delete=1`（沿用 `soft-delete.js` 的 `/api/photos/soft-delete`），**不动任何文件**，视频立刻从视频库列表消失。
- 回收站管理页：http://whfnas:3060/videoer/trash.html（videoer 右上角"🗑 回收站"、nasmgr 顶部也有入口）：缩略图预览、按时间/大小/路径排序、搜索、恢复选中（`/api/photos/restore`）、复制路径、**导出物理删除清单**（`GET /api/video-trash/export`，每行 大小 / Windows 盘符路径 / NAS 路径，UTF-8 带 BOM 的 txt）、"清理已手动删除的记录"（`POST /api/video-trash/purge-missing`：回收站里文件已不在磁盘的，删库记录和缩略图；标签/标记/特征仅在没有别的视频共用同一 key 时才清）。
- 物理删除由用户手动做：拿导出清单删完后，回收站页面点"清理已手动删除的记录"。回收站模块：`video-trash.js`；页面不提供物理删除按钮。图片的旧回收站页是 `/viewer/trash.html`（带物理删除，图片用）。

## 十、播放器"在线"标签的教训（2026-09-30）

- 根因：`web_ready>0` 的视频，播放器原先一律先请求"转换/"目录里的换壳/转码副本（`/convfiles/...`）。无损修复、换壳替换、转码顶替做完后副本已经被顶替进原位或清掉了（当时约 2.2 万个视频副本不在），请求 404，浏览器把 404 报成"浏览器无法播放此格式"——跟编码无关。
- 修复（`videoer/js/player.js`）：第一次失败如果用的是副本地址，先退回 `/original` 原文件再试一次；原文件也失败才算这个浏览器真的播不了，才记进本浏览器 localStorage（`vplBadMd5v2`）并隐藏"在线"标签；提示里加了"关闭"按钮。路径按段 `encodeURIComponent`。

## 十一、转码范围与参数（2026-09-30）
- 自动转码排队（⑪）只包含 `/share/Person` 下的视频；`/share/Media` 等其它目录不自动转，要转由用户手动添加。
- 超过 6GB 的视频不转码、保留源文件；BAK 里的原文件永远保留。
- 转码副本比源文件还大的原因：旧参数 `-cq 20` 且不限码率。现改为 NVENC `-rc vbr -cq 24 -b:v 0` + `-maxrate=源码率`，x264 备用 crf 23/25 同样带上限。
- PC 端 `VconvAgent.ps1 -CpuOnly`：第二个实例，只做 x264 转码，从队列尾取活；GPU 实例从队首取。备份：`.bak_20260930`、`.bak_before_cpuonly`。
- 服务器改队列（重启 nas-media）会清空内存里的转码队列，需要在 ⑪ 重新"加入队列"。

## 十二、viewer 提速（2026-09-30）
- SQLite: cache 256MB、mmap 1GB、列表联合索引 idx_photos_list / idx_photos_mt_list、WAL 定期合并、启动预热（routes.js 顶部 [perf] 段）。
- 列表总数缓存 30 秒（SqlitePhotoRepository.findAll）。
- 标签云 /api/photo-tags/cloud 冷查询约 5 秒且会卡住整个 nas-media：前端改为页面加载完后最后取，后端启动 90 秒后预热、缓存 6 小时。
- 注意：routes.js 是单文件挂载，修改后必须 `docker restart nas-media`。

## 十三、文件名清理 + viewer 提速第二轮（2026-09-30）
- nasmgr ⑫：视频/照片文件名清洗（video-rename.js）。规则、日志（/share/ssd001/video-rename/）、回滚都在页面上。照片改名会同步重算 photos.file_key（= md5(文件名_大小_mtime)，只在原值匹配旧名公式时改）。视频 file_key 全为空。
- 目录筛选/`/api/dir-stat` 改为路径范围 + `INDEXED BY idx_photos_path`（LIKE 用不上索引，优化器还会选错 media_type 索引扫全表）；范围查不到时退回 LIKE。
- 列表总数缓存 5 分钟；启动 3 秒后自己请求默认列表/marks/groups 预热。
- 教训：新增索引 idx_photos_mt_list 曾让 /api/marks/stats 从 7ms 退化到 400ms（优化器改成先扫 photos 再连 photo_marks）。已在 marks.js 用 CROSS JOIN 固定连接顺序。以后加索引后要重测各接口耗时。
- 仍偏慢（未处理）：`/api/photo-tags/photos`（按标签筛选）冷查询约 1 秒；`/api/photos/stats/by-dir` 大目录约 150ms（要汇总 14 万行）。

## 十四、缩略图缺失修复（2026-09-30）
- 现象：viewer 某些目录瀑布流空白。原因有二：① 列表缓存只按 MAX(id) 判断变化，处理完成/改名后返回过期数据（已改为带写入计数）；② 迁移到 SSD 时约 3000 张照片的旧格式路径 thumbs/<md5>_thumb.jpg 文件没带过来。
- 修复脚本：services/nas-media/fix_missing_thumbs.js（用容器内 sharp 从原图补生成：缩略图最长边200、预览图最长边1920，分目录路径；幂等；`--dry` 只统计）。运行：`docker cp` 到容器 /tmp 后 `docker exec -e NODE_PATH=/app/node_modules nas-media node /tmp/fix_missing_thumbs.js`。
- 结果：3006 个内容(md5)，新生成 2624，仅修正路径 382，失败 0。NAS 各卷上没有找到旧文件（迁移时已不在）。
- 真正待处理(没缩略图)的照片约 4300 张，需电脑上的 nas_client.py 处理。

## 十五、照片入库 + 处理队列（nasmgr ⑬，2026-09-30）
- 原来"每点一个目录开一个处理线程"会同时跑满 CPU、卡死服务；且"入库"和"处理"是两步，页面只数库里已有的待处理，导致 1 万张只显示几千。现统一成一个持久化队列。
- 表：ingest_queue（每张图一行：排队/处理中/完成/失败）、ingest_jobs（扫描任务）、ingest_state（running/speed/heartbeat）。工人：public/js/ingest-worker.js（独立线程，常驻）；接口：public/js/ingest-queue.js。
- 入口：目录树右键"处理"、media-admin 批量处理、nasmgr ⑬ 输入框，全部只是 POST /api/ingest/add；已处理完的自动跳过。速度档 慢1/稳2/快4 张并发，超过30MB的大图单张处理。
- 处理规则：图片里已有 NAS_MD5 标记就沿用（不重算不重写）；没有则算一次并原子写入（先写临时文件、读回校验、保持修改时间/权限）；只对文件头是 JPEG/PNG 的写标记，其它格式只算 md5。同时生成缩略图/预览图/phash/EXIF 时间。
- 服务重启：处理中的自动放回排队，工人自动恢复；用户点过"暂停"则保持暂停。
- 旧接口 /api/process/nas、/api/photo-process/* 仍在但页面不再使用。

## 十六、目录树统一（2026-10-01）
- 三个页面共用 `/api/dir-tree`：`media=photo`（viewer，库里有照片的目录）、`media=video`（videoer，库里有视频的目录）、`media=all`（media-admin，数据库 ∪ 磁盘一层，全部显示，含还没入库的）。photo/video 只查数据库、逐层展开、无层数限制，返回 `count`(子树总数)/`own`(目录自身数)。
- 缓存：服务器按"数据库最大 id + 2 分钟"（内存）；不再按目录修改时间（改名/写 md5 标记会让它一直失效，这是之前"目录树全部显示"的根因）。浏览器端另有 IndexedDB 缓存（先显示旧的再校验）。
- 旧的 `/api/photo-tags/dirs` 仍在，但 videoer 不再使用（它最多 6 层）。
- 待入库目录：nasmgr ⑭（`/api/ingest/discover*`），扫描磁盘找"磁盘图片数 > 库里记录数"的目录，可一键加入 ⑬ 队列（只入库该目录本身）。
- 写 md5 标记踩坑：部分 JPEG 内嵌缩略图损坏，piexif.dump 抛 "Given data isn't JPEG." → 写前丢掉 1st IFD/thumbnail（ingest-worker.js、photo-worker-thread.js 已修）。

## 十七、统一回收站（2026-10-01）
- 图片库、视频库所有"删除"入口都只是 `/api/photos/soft-delete`（pending_delete=1，不动文件）。viewer 网格/大图右键已去掉"彻底删除"，改为"放入回收站"。
- 回收站只有一个页面 `/viewer/trash.html`（`?type=photo|video` 预设筛选；`/videoer/trash.html` 自动跳转），顶部"全部/图片/视频"筛选，可搜索、排序、分页、恢复、彻底删除、导出清单、清理"文件已不在盘"的记录。接口在 `public/js/trash.js`（`/api/trash/*`）。
- 彻底删除：原文件 + 视频转码/换壳副本 + 库记录；缩略图/标签/收藏**只有没有别的记录共用同一个 md5 时才清**（已验证重复文件不会被误伤）；BAK 里的文件需二次确认（`confirmBak`）；电脑盘符路径只清库记录。
- 旧接口 `/api/photos/confirm-delete`（会连共用缩略图一起删）和 `/api/video-trash/delete` 仍在但页面不再使用；`/api/photos/delete-full` 同样不再被页面调用。
- 踩坑：内容相同的文件并发处理会抢同一个 `.tmp` 缩略图文件导致 ENOENT 失败，已改为随机临时文件名（ingest-worker.js）。
