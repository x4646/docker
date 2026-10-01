// 2026-09-20: 整个src/目录已经从TypeScript转换成纯JS(domain/infrastructure/interfaces/
// application/shared/container全部有对应的.js版本了, 逻辑完全一致, 见各文件里的转换记录)。
// 这个文件之所以还留着.ts后缀、内容只是个转发, 纯粹是因为Dockerfile的CMD写死了
// "ts-node-dev ... src/index.ts", 改CMD要重新build镜像, 属于更大的改动。
// 保持这个文件名不变、内容改成直接require真正的JS入口, ts-node-dev(--transpile-only,
// 不做类型检查)跑这一行代码本身没有任何额外开销, 效果上等同于直接跑JS。
require('./index.js');
