# GIS 综合服务 API 测试文档

> 最后核对：2026-08-16  

> 依据：当前入口 `index.py`、应用 `src/app.py` 及 `src` 下各业务模块的实际实现。  
> 本文只记录当前已注册接口，不包含尚未实现的设计接口。

## 1. 测试前约定

默认服务地址：

```text
http://127.0.0.1:8082
https://wechat.liaoliaofarm.com/
```

启动：

```powershell
python index.py
```

下文 HTTP 示例中的 `{{baseUrl}}` 表示上述地址。GeoJSON 坐标顺序均为 `[经度, 纬度]`。

- JSON 请求头：`Content-Type: application/json`。
- 普通查询接口不校验令牌。
- `/py/GengDi/create/validate`、`create`、`geometry`、`update`、`remove` 默认要求通过 `/py/GengDi/gettoken` 获取的临时 Token。
- `/py/GengDi/delete` 只要求与其他写接口相同的耕地临时 Token，不校验 HTTPS、代理、管理员令牌或临时数据库账户。
- `/py/GengDi`、`/py/test/GengDi`、`/py/uat/GengDi`、`/py/demo/GengDi` 分别固定绑定 Pro、Test、UAT、Demo，请求体不能切换数据库环境。
- 自动化验证不得调用任何真实环境写接口；确需执行数据库事务测试时，只允许连接 `onemap_test` 并强制回滚。
- 示例 ID、编号、地址、行政区代码和坐标均需按测试库真实数据替换。
- 所有 JSON 接口的顶层 `code` 都是数字，并与实际 HTTP 状态一致；成功固定为 `200`。

### 全局 HTTP 状态码约定

HTTP 状态码是响应起始行中的三位十进制整数，例如 `HTTP/1.1 400 Bad Request` 中的数字 `400`；它不是字符串。所有新旧 JSON 接口的顶层 `code` 也必须是数字，并且与实际 HTTP 状态完全一致：成功统一为 HTTP `200` 和 `"code":200`，失败统一为对应 HTTP `4xx/5xx` 和相同数字 `code`。稳定英文错误标识放在可选字符串字段 `errorCode`，不得再写入 `code`。

响应发送前会执行全局校正：JSON 对象会写入顶层数字 `code`；历史顶层 JSON 数组会包装为 `{"code":200,"message":"ok","data":[...]}`；GeoJSON 对象保留 `type/features` 等原字段并增加顶层 `code`。HTML、纯文本和文件下载不是 JSON 响应，只以数字 HTTP 状态表示成功或失败。

| HTTP 状态 | 统一含义 |
| --- | --- |
| `200` | 请求成功；查询无匹配时由业务字段（如 `data.found=false`）说明，不作为请求错误。 |
| `400` | 缺少参数、参数类型或请求体格式不合法。 |
| `401` | 身份令牌或账号密码无效、过期。 |
| `403` | 已认证但无写入、删除等操作权限。 |
| `404` | 请求路径、指定业务资源或目标目录不存在。 |
| `405` | 请求方法不被该路径支持。 |
| `409` | 资源状态冲突，例如重复创建或文件已存在。 |
| `413` | 请求体或上传文件超过大小限制。 |
| `415` | 不支持的媒体或文件类型。 |
| `422` | 请求格式正确但几何、业务规则等语义校验失败。 |
| `500` | 应用配置、数据库或未预期内部异常。 |
| `502` | FTP/SFTP 等上游服务异常。 |
| `503` | 服务或指定能力被关闭、暂不可用。 |

本服务批准使用的 HTTP 状态仅为上表中的数字。未注册路径、错误 HTTP 方法、未捕获的异常也会返回对应数字 HTTP 状态及 JSON 错误体，例如 HTTP 404 对应 `{"code":404,"errorCode":"HTTP_404","message":"...","data":null}`；竖线分隔的多个错误标识不得写进真实响应。

建议先执行：

```http
GET {{baseUrl}}/py/api/ping
```

## 2. 接口总览

| # | 方法 | 路径 | 说明 |
| ---: | --- | --- | --- |
| 1 | GET | `/` | 根路径检查 |
| 2 | GET | `/py/api/interface-self-test` | 全环境接口自我测试页面 |
| 2a | GET/POST | `/py/api/lookup-test` | 自测页旧入口，保留兼容 |
| 2b | GET | `/py/api/interface-self-test/manifest` | 独立接口清单、Flask 注册对账及数据源说明 |
| 2c | POST | `/py/api/interface-self-test/dependencies` | MySQL/PostGIS 连接与表存在性只读探测 |
| 3 | GET | `/py/api/ping` | 健康检查 |
| 4 | GET/POST | `/py/getSoilNPKpng` | 土壤专题图与分级面积 |
| 5 | GET | `/getPlotAltitude` | 地块边界 DEM 高程 |
| 6 | GET | `/detectoutliers` | DEM 算法测试 |
| 7 | GET | `/py/getcentroid` | 附近要素及质心距离 |
| 8 | GET | `/py/getpolygon` | 坐标所在面 |
| 9 | POST | `/py/getplotgroup` | 地块分组 |
| 10 | POST | `/py/getplotgroupweather` | 地块组天气 |
| 11 | POST | `/py/getplotgroupnutrient` | 地块养分 |
| 12 | POST | `/py/getRtkLatLonTrajectory` | 轨迹作业指标 |
| 12a | POST | `/py/getRtkLatLonTrajectoryByDevs` | 多作业轨迹汇总指标（新增） |
| 12b | POST | `/py/getplotByLonLatangle` | 视锥范围查询地块及处方（新增） |
| 13 | POST | `/py/getPlotBoundary` | 地块聚类凸包 |
| 14 | GET | `/py/getroad` | 路网最短路径 |
| 15 | POST | `/py/api/region/lookup` | 点坐标反查行政区 |
| 16 | POST | `/py/api/region/lookuparea` | 范围反查行政区（新增） |
| 17 | GET | `/py/api/region/lookup/cache_stats` | 行政区缓存统计 |
| 18 | POST | `/py/api/getLand_plot_range` | 地块范围数据；临时固定读取 Test |
| 18a | POST | `/py/test/api/getLand_plot_range` | 地块范围数据；固定读取 Test |
| 19 | POST | `/py/clip_Line_polygon_points/import` | 导入点线面 |
| 20 | GET/POST | `/py/clip_Line_polygon_points/query` | 查询点线面 |
| 21 | POST/DELETE | `/py/clip_Line_polygon_points/delete` | 删除点线面 |
| 22 | GET/POST | `/py/api/getSoildataByLngLat` | 坐标查询土壤栅格 |
| 23 | POST | `/py/getLangjiu_survey_area` | 郎酒测区 |
| 24 | GET/POST | `/py/land_address_search_area` | 地址模糊查询地块面积 |
| 25 | POST | `/py/GengDi/gettoken` | 账户登录并签发耕地临时 Token |
| 26 | POST | `/py/GengDi/query/geometry` | 按几何查询地块（新增） |
| 27 | POST | `/py/GengDi/query/ids` | 按 ID 查询地块（新增） |
| 28 | POST | `/py/GengDi/query/serialnos` | 按编号查询地块（新增） |
| 29 | POST | `/py/GengDi/create/validate` | 新增预检（新增） |
| 30 | POST | `/py/GengDi/create` | 批量新增地块（新增） |
| 31 | POST | `/py/GengDi/geometry` | 更新地块几何（新增） |
| 32 | POST | `/py/GengDi/update` | 更新地块非几何属性（新增） |
| 33 | POST | `/py/GengDi/remove` | 逻辑清除地块（新增） |
| 34 | DELETE | `/py/GengDi/delete` | 物理删除地块（新增） |
| 35 | POST | `/py/poi/query` | 按空间范围查询兴趣点 |
| 36 | POST | `/py/poi/add` | 新增兴趣点 |
| 37 | POST | `/py/poi/update` | 按 geoid 更新兴趣点及名称 |
| 38 | DELETE | `/py/poi/delete` | 按 geoid 删除兴趣点 |

上表按正式环境主路径列出；`GengDi` 的 Test、UAT、Demo 同构路径以及 POI 的 Test 同构路径未重复编号，支持多种 HTTP 方法的同一路径在表中合并为一项。

更新接口 `/py/GengDi/geometry`、`/py/GengDi/update`、`/py/poi/update` 及其同构环境路径统一只接受 `POST`；旧 `PATCH` 方法已取消，使用时返回 HTTP `405`。

## 3. 基础接口

### 3.1 根路径

```http
GET {{baseUrl}}/
```

返回纯文本：

```text
Hello, World! abc
```

### 3.2 接口自我测试

```http
GET {{baseUrl}}/py/api/interface-self-test
```

成功时返回 `static/index.html`。页面支持 Pro/Test/UAT/Demo 选择，对独立预期路由清单和 Flask 实际注册表进行对账，通过 `OPTIONS` 验证实际部署 URL 的通达性，并只读检查 MySQL/PostGIS 连接和表存在性。页面显示数据环境、服务器、数据库、schema 和表名，不显示用户名和密码。

旧入口 `/py/api/lookup-test` 保留，GET/POST 均返回同一页面。清单 API 为 `GET /py/api/interface-self-test/manifest?environment=UAT`，依赖探测 API 为 `POST /py/api/interface-self-test/dependencies`。详细用法见 `接口自我测试.md`。

可通过 `INTERFACE_SELF_TEST_ENABLED=0` 关闭；如配置 `INTERFACE_SELF_TEST_TOKEN`，调用清单与依赖探测 API 时必须提交 `X-Self-Test-Token`。

### 3.3 健康检查

```http
GET {{baseUrl}}/py/api/ping
```

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "service": "region_lookup",
    "epoch": 1786870800.0,
    "server_time": "2026-08-16 18:20:00"
  }
}
```

### 3.4 DEM 平滑算法测试

```http
GET {{baseUrl}}/detectoutliers
```

固定返回纯文本 `detect_outliers`。

## 4. 行政区与地块范围查询

### 4.1 点坐标反查行政区

```http
POST {{baseUrl}}/py/api/region/lookup
Content-Type: application/json

{
  "lon": 106.55,
  "lat": 29.56,
  "srid": 4490,
  "level": "village",
  "isgetShp": false,
  "isHitpoint": false,
  "useCache": true,
  "forceRefresh": false
}
```

参数：

| 参数 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `lon`/`lng` | 是 | - | 经度 |
| `lat` | 是 | - | 纬度 |
| `srid` | 否 | 4490 | 输入坐标系 |
| `level` | 否 | `village` | `province/city/county/town/village/town_village` |
| `isgetShp`/`isGetShp` | 否 | false | 是否返回行政区几何 |
| `isHitpoint` | 否 | false | 热点标记 |
| `useCache` | 否 | true | 是否使用缓存 |
| `forceRefresh` | 否 | false | 是否强制刷新 |

未命中不是请求错误，通常仍返回 HTTP 200，并在 `data.found` 中体现。

### 4.2 范围反查行政区（新增）

Polygon 与 `bbox` 必须二选一。

Polygon 请求：

```http
POST {{baseUrl}}/py/api/region/lookuparea
Content-Type: application/json

{
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[106.50, 29.50], [106.51, 29.50], [106.51, 29.51], [106.50, 29.51], [106.50, 29.50]]]
  },
  "srid": 4490,
  "isgetgeom": false
}
```

矩形请求：

```http
POST {{baseUrl}}/py/api/region/lookuparea
Content-Type: application/json

{
  "bbox": {
    "minLon": 106.50,
    "minLat": 29.50,
    "maxLon": 106.51,
    "maxLat": 29.51
  },
  "srid": 4490,
  "isgetgeom": true
}
```

约束：只支持无洞的简单 `Polygon`；环必须闭合，4～2000 个坐标点；`srid` 只能是 `4326` 或 `4490`。面积不超过 15 km² 返回最多 2 个村，15～60 km² 返回最多 2 个乡镇，大于 60 km² 返回相交面积最大的 1 个区县。

成功响应核心结构：

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "found": true,
    "areaSqKm": 1.057321,
    "selectedLevel": "village",
    "addressText": "重庆市/重庆市/江津区/示例镇/示例村",
    "addresses": [],
    "coverageSummary": {
      "cityCount": 1,
      "countyCount": 1,
      "townCount": 1,
      "villageCount": 1
    }
  },
  "meta": {"srid": 4490, "environment": "Test", "elapsedMs": 12.3}
}
```

几何或参数错误返回 HTTP 422、`code=422`、`errorCode=INVALID_GEOMETRY`；数据库错误返回 HTTP 500、`code=500`、`errorCode=DATABASE_ERROR`。

### 4.3 行政区缓存统计

```http
GET {{baseUrl}}/py/api/region/lookup/cache_stats
```

无参数。返回 `{code,message,data}`，`data` 是当前进程缓存统计，并在 `data.scope` 中显示当前 `environment/database/schema`。lookup 缓存键包含环境、数据库和 schema，相同坐标在 Test 与 Pro 不会共用缓存；启动预热完成标记也按相同范围隔离。

### 4.4 点和半径查询地块范围

```http
POST {{baseUrl}}/py/api/getLand_plot_range
Content-Type: application/json

{
  "lon": 106.55,
  "lat": 29.56,
  "srid": 4490,
  "radius": 1000
}
```

`lon`/`lng`、`lat` 必填；`srid`、`radius` 可选。当前业务实现会返回配置表中的整表 GeoJSON，`radius` 尚未用于空间过滤，测试时需注意响应可能较大。

`POST /py/api/getLand_plot_range` 与 `POST /py/test/api/getLand_plot_range` 当前都固定读取 Test 的 `land_plot_r`，两者请求和响应完全一致，请求参数不能切换环境。这是唯一允许正式路径读取测试库的临时兼容例外，不适用于任何其他接口。未来应在 Pro 部署独立数据表并按路径分环境，或者取消该接口；完成迁移后必须移除此例外。

### 4.5 中文地址模糊查询地块面积

```http
POST {{baseUrl}}/py/land_address_search_area
Content-Type: application/json

{
  "keyword": "四川省成都市郫都区唐昌镇"
}
```

GET 等价示例：

```http
GET {{baseUrl}}/py/land_address_search_area?keyword=四川省成都市郫都区唐昌镇
```

关键词兼容字段：`keyword/address/locationaddress/locationAddress/q`。无匹配时返回空 `relatedMatchResults`、面积 `0`、经纬度 `null`。

## 5. `/py/GengDi` 地块接口（新增）

四环境使用相同的子路径、方法、请求体和响应结构：

| 环境 | 父路径 | 默认数据库 |
| --- | --- | --- |
| Pro | `/py/GengDi` | `onemap` |
| Test | `/py/test/GengDi` | `onemap_test` |
| UAT | `/py/uat/GengDi` | `onemap_uat` |
| Demo | `/py/demo/GengDi` | `onemap_demo` |

下文示例使用 Pro 父路径；调用其他环境时只替换父路径。服务不注册其他拼写的兼容路径。

### 5.1 通用响应与鉴权

只有正式父路径提供登录签发接口，Test、UAT、Demo 不重复注册 `gettoken`：

```http
POST {{baseUrl}}/py/GengDi/gettoken
Content-Type: application/json

{
  "username": "admin",
  "password": "admin987"
}
```

账户密码分别由 `GENGDI_API_USERNAME`、`GENGDI_API_PASSWORD` 静态配置，和 XFTP 账户相互独立。默认值为 `admin/admin987`，部署时建议更换密码。成功响应的 `data` 包含 `accessToken`、`tokenType=Bearer`、`expiresIn=86400` 和 `expiresAt`。Token 默认有效期一天，到期后重新登录签发；服务端签名密钥不会通过接口返回。

查询成功：

```json
{
  "code": 200,
  "message": "ok",
  "data": {},
  "requestId": "自动生成或来自 X-Request-ID",
  "meta": {"environment": "Test", "srid": 4490, "elapsedMs": 8.5}
}
```

错误响应的顶层 `code` 仍为数字；具体原因使用字符串 `errorCode`，例如 `INVALID_ARGUMENT`、`INVALID_GEOMETRY`、`PARCEL_NOT_FOUND`、`DUPLICATE_GEOMETRY`、`PARCEL_CLAIMED`。

| HTTP 状态（数字） | 响应体 `code`（数字） | 可选 `errorCode`（字符串） | GengDi 常见场景 |
| --- | --- | --- | --- |
| `200` | `200` | 无 | 登录、查询、预检、新增、更新或清除成功；查询未命中也返回成功，由空数组或 `notFound` 表示 |
| `400` | `400` | `INVALID_ARGUMENT` | 请求体、必填参数、参数类型或取值不合法 |
| `401` | `401` | `INVALID_CREDENTIALS` / `WRITE_UNAUTHORIZED` | 登录账号密码错误，或写 Token 缺失、无效、过期 |
| `404` | `404` | `PARCEL_NOT_FOUND` | 更新或清除指定的地块不存在 |
| `409` | `409` | `DUPLICATE_GEOMETRY` / `PARCEL_CLAIMED` / `PARCEL_REMOVED` | 几何重复、地块仍被认领或地块状态冲突 |
| `413` | `413` | `PAYLOAD_TOO_LARGE` / `DELETE_LIMIT_EXCEEDED` | 几何、数组或批量清除数量超过限制 |
| `422` | `422` | `INVALID_GEOMETRY` / `INVALID_UPDATE_FIELD` / `GEOMETRY_UPDATE_NOT_ALLOWED` | 几何或业务语义校验失败 |
| `500` | `500` | `INVALID_CONFIG` / `DATABASE_ERROR` / `BACKUP_FAILED` / `INTERNAL_ERROR` | 配置、数据库、备份或未预期内部异常 |

例如参数错误的真实响应是数字 HTTP `400`，响应体为 `{"code":400,"errorCode":"INVALID_ARGUMENT",...}`。HTTP 和 `code` 都不能写成字符串。

写请求通用请求头：

```http
Authorization: Bearer {{gengdiAccessToken}}
X-Request-ID: TEST-20260816-001
```

也兼容使用 `X-GengDi-Write-Token: {{gengdiAccessToken}}` 承载同一个临时 Token。若 `GENGDI_REQUIRE_WRITE_TOKEN=1`（默认），无 Token、签名错误或 Token 过期均返回 HTTP 401。

### 5.2 按点、线或面查询地块

```http
POST {{baseUrl}}/py/GengDi/query/geometry
Content-Type: application/json

{
  "geometry": {"type": "Point", "coordinates": [106.55, 29.56]},
  "srid": 4490,
  "isgetgeom": true,
  "includeRemoved": false,
  "limit": 100,
  "offset": 0
}
```

`geometry` 支持 `Point`、`LineString`、`Polygon`、`MultiPolygon`。Point 使用覆盖判断，边界点也可命中；其他类型使用相交判断。`limit` 为 1～1000，默认 100。

返回 `data.items` 中固定包含 `id/farmlandid/serialno/landname/locationaddress/mapareasize/landno/locationlatitude/locationlongitude/isremove`；`isgetgeom=true` 时增加 `geometry`。

### 5.3 按 ID 数组查询

```http
POST {{baseUrl}}/py/GengDi/query/ids
Content-Type: application/json

{
  "ids": [200739, 200740, 999999999],
  "isgetgeom": false,
  "includeRemoved": false,
  "srid": 4490
}
```

最多 500 个正整数 ID，自动去重，返回顺序与请求顺序一致；未命中值位于 `data.notFound`。

### 5.4 按 serialno 数组查询

```http
POST {{baseUrl}}/py/GengDi/query/serialnos
Content-Type: application/json

{
  "serialnos": ["PLOT-001", "PLOT-002"],
  "isgetgeom": true,
  "includeRemoved": false,
  "srid": 4490
}
```

最多 500 个编号，每个编号长度 1～128；未命中值位于 `data.notFound`。

### 5.5 新增预检

该接口执行与新增相同的鉴权、行政区代码校验、几何校验、重复校验及派生字段计算，但事务回滚，不插入数据。

```http
POST {{baseUrl}}/py/GengDi/create/validate
Content-Type: application/json
X-GengDi-Write-Token: {{gengdiAccessToken}}
X-Request-ID: VALIDATE-20260816-001

{
  "srid": 4490,
  "items": [
    {
      "farmlandid": null,
      "province": "重庆市",
      "city": "重庆市",
      "regioncode": "500116",
      "regionname": "江津区",
      "townstreetcode": "500116000",
      "townstreetname": "示例镇",
      "villagecode": "500116000000",
      "villagename": "示例村",
      "landtypename": "旱地",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[106.5000, 29.5000], [106.5010, 29.5000], [106.5010, 29.5010], [106.5000, 29.5010], [106.5000, 29.5000]]]
      }
    }
  ]
}
```

必填业务字段只有 `landtypename`、`geometry`。`province`、`city`、`regioncode`、`regionname`、`townstreetcode`、`townstreetname`、`villagecode`、`villagename` 均为可选；缺失的行政区名称会优先使用几何质心 lookup 结果补齐。`landtypename` 只接受 `水田`、`旱地`；`水浇地` 会归一化为 `旱地`。禁止给 `farmid` 赋非零值。新增仅接受 Polygon/MultiPolygon，MultiPolygon 会拆为多条记录，拆分后最多 200 个 Polygon。

行政区代码按以下规则规范化，但 lookup 不再阻止新增：

- `regioncode` 只取末 6 位，且必须全部是数字。
- `townstreetcode` 只取末 3 位，且必须全部是数字。
- `villagecode` 只取末 3 位，且必须全部是数字。
- 三段用户编码均有效时，最终 `villagecode = regioncode(6) + townstreetcode(3) + villagecode(3)`；用户编码优先，即使与空间 lookup 不同也继续新增。
- 任一段缺失、长度不足或末位不是纯数字时，若 lookup 可用，则采用 lookup 村编码，并分别保存 6 位区县码、3 位乡镇码和 12 位完整村码。
- 用户编码与 lookup 不一致时返回 `ADMIN_REGION_MISMATCH` 警告；采用 lookup 回退时返回 `ADMIN_CODE_LOOKUP_FALLBACK` 警告。
- 最终兜底村编码固定为 `500112022000`，对应 `重庆市 / 两江新区 / 康美街道 / 银竹苑 3 区`。当用户编码无效且 lookup 未返回完整有效编码时，保存 `province=重庆市`、`city=重庆市`、`regioncode=500112`、`regionname=两江新区`、`townstreetcode=022`、`townstreetname=康美街道`、`villagecode=500112022000`、`villagename=银竹苑 3 区`，并返回 `ADMIN_STATIC_CODE_FALLBACK` 警告。
- 用户编码有效但 lookup 不可用时，继续使用用户编码并返回 `ADMIN_LOOKUP_UNAVAILABLE`。上述所有告警情况均不返回 4xx，也不回滚新增。

### 5.6 批量新增地块

请求结构与 5.5 完全一致，仅路径不同：

```http
POST {{baseUrl}}/py/GengDi/create
Content-Type: application/json
X-GengDi-Write-Token: {{gengdiAccessToken}}
X-Request-ID: CREATE-20260816-001

{
  "srid": 4490,
  "items": [
    {
      "farmlandid": null,
      "province": "重庆市",
      "city": "重庆市",
      "regioncode": "请替换真实区县代码",
      "regionname": "请替换真实区县名",
      "townstreetcode": "请替换真实乡镇代码",
      "townstreetname": "请替换真实乡镇名",
      "villagecode": "请替换真实村代码",
      "villagename": "请替换真实村名",
      "landtypename": "旱地",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[106.5000, 29.5000], [106.5010, 29.5000], [106.5010, 29.5010], [106.5000, 29.5010], [106.5000, 29.5000]]]
      }
    }
  ]
}
```

建议测试顺序：先调用 `/create/validate`，确认 `data.items[].status=ready` 并检查 `data.warnings`，再调用 `/create`。新增成功的 `status` 为 `created`，并返回生成的 `id/farmlandid/serialno/landname/locationaddress/mapareasize/landno/locationlatitude/locationlongitude/isremove`。行政区告警同时出现在 `data.warnings` 和对应 `data.items[].warnings`，仅作提示，不代表新增失败。预检不会调用数据库序列，因此 `/create/validate` 的 `landno` 为 `null`；正式 `/create` 返回实际生成的 `landno`。整批请求使用同一事务，任一真正的新增错误仍会使整批回滚。

`landname` 按完整 `locationaddress` 计算。服务读取该地址全部现有地块名称，提取每个 `_` 或 `-` 符号后出现的数字；同一名称同时含两种符号或多个数字时也参与比较，并取全体最大数字。首个新编号为“最大数字 + 当前同地址地块总数”，无历史地块时从 1 开始；同一批次内相同地址的后续地块依次加 1。名称仍使用 `村名_编号` 格式。服务按完整地址加事务级锁，避免并发重名。

### 5.7 批量更新地块几何

```http
POST {{baseUrl}}/py/GengDi/geometry
Content-Type: application/json
X-GengDi-Write-Token: {{gengdiAccessToken}}
X-Request-ID: UPDATE-GEOM-20260816-001

{
  "srid": 4490,
  "items": [
    {
      "id": 200739,
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[106.5000, 29.5000], [106.5011, 29.5000], [106.5011, 29.5011], [106.5000, 29.5011], [106.5000, 29.5000]]]
      }
    }
  ]
}
```

一次最多 50 条，ID 不能重复，只接受 Polygon。接口只更新 `geom` 和 `updatetime`，不会重新生成 `serialno/landname/面积/质心`。已逻辑清除的记录不能更新。

### 5.8 批量更新地块属性

正式、Test、UAT、Demo 均提供同构路径。外层 `id` 用于定位原记录；要修改主键时，把新值写在 `properties.id` 中。

```http
POST {{baseUrl}}/py/GengDi/update
Content-Type: application/json
X-GengDi-Write-Token: {{gengdiAccessToken}}

{
  "items": [
    {
      "id": 200739,
      "properties": {
        "landremark": "已复核",
        "landtypename": "旱地"
      }
    }
  ]
}
```

一次最多 50 条，定位 ID 不得重复，整批在同一事务中完成。可更新当前地块表中除 `geom` 外的实际数据库列；提交 `geom` 或 `geometry` 会返回 `GEOMETRY_UPDATE_NOT_ALLOWED`，几何必须使用 `/GengDi/geometry`。已逻辑清除的记录不能更新。未显式提交 `updatetime` 时由服务更新为当前时间。

成功项返回与 `create`/查询一致的 `id/farmlandid/serialno/landname/locationaddress/mapareasize/landno/locationlatitude/locationlongitude/isremove`、`area/updatetime/status/changedFields`，并附加本次修改的其他属性。若修改了 `id`、`farmid` 或 `serialno`，响应的 `message`、`data.warning` 及对应记录的 `warning` 均为 `更新涉及业务字段，请注意同步`，同时通过 `businessFields` 列出涉及字段。

### 5.9 逻辑清除地块

```http
POST {{baseUrl}}/py/GengDi/remove
Content-Type: application/json
X-GengDi-Write-Token: {{gengdiAccessToken}}
X-Request-ID: REMOVE-20260816-001

{
  "ids": [200739]
}
```

一次最多 20 个 ID，只要求记录存在且 `isremove=0`；逻辑清除不检查 `farmid` 认领状态。成功前会将完整记录备份为本地 GeoJSON，再设置 `isremove=1`；响应中的 `data.backup` 包含备份路径和 SHA-256。

### 5.10 物理删除地块

鉴权只使用与 `create/geometry/update/remove` 相同的耕地临时 Token。物理删除始终要求有效 Token，即使其他写接口通过配置关闭了 Token 校验也不例外。不校验 HTTPS 或代理请求头，不要求管理员 Token、数据库用户名/密码、`isTrueDelete`，也不要求记录已逻辑清除。

```http
DELETE {{baseUrl}}/py/GengDi/delete
Content-Type: application/json
X-GengDi-Write-Token: {{gengdiAccessToken}}
X-Request-ID: HARD-DELETE-20260816-001

{
  "ids": [200739]
}
```

一次最多 20 个 ID；目标必须存在。若任一目标 `farmid` 非空且数值大于 0，整批返回 HTTP 409、`code=409`、`errorCode=PARCEL_CLAIMED`、`message=地块处于认领状态，无法清除，请解除认领后清除`。解除认领后才能物理删除。删除前仍写本地 GeoJSON 备份，批次任一失败则整体回滚。不要把真实 Token 写入文档、测试代码或日志。

## 6. 兴趣点（POI）空间 CRUD

POI 的正式和测试接口在同一服务进程中同时发布，子路径、方法、请求体和响应格式完全相同：

| 环境 | 固定父路径 | 默认数据库 |
| --- | --- | --- |
| Pro | `/py/poi` | `onemap` |
| Test | `/py/test/poi` | `onemap_test` |

环境只由父路径确定，不再读取 `POI_ENVIRONMENT`，请求体不能切换环境、数据库、schema 或表。下文示例使用正式父路径；调用测试库时仅把 `/py/poi` 替换为 `/py/test/poi`。`geoid` 是 POI 唯一主键和 API 定位字段；数据源的 `OBJECTID` 对外返回为 `objectid`，仅用于高德源数据追踪，可为空且不要求唯一。

### 6.1 空间查询

```http
POST {{baseUrl}}/py/poi/query
Content-Type: application/json

{
  "geometry": {"type": "Point", "coordinates": [106.484609, 29.6381766]},
  "srid": 4326,
  "radiusMeters": 1000,
  "limit": 100,
  "offset": 0
}
```

查询必须提供 `geometry`，支持 `Point/LineString/Polygon/MultiPolygon`。Point 使用 `radiusMeters` 空间半径，默认 1,000 米；其他几何使用 `ST_Intersects`。不支持名称模糊查询，传入 `name`、`keyword` 或 `q` 会返回 `UNSUPPORTED_QUERY`。

### 6.2 新增

```http
POST {{baseUrl}}/py/poi/add
Content-Type: application/json

{
  "name": "了了重庆农业科技有限公司",
  "geometry": {"type": "Point", "coordinates": [106.484609, 29.6381766]},
  "srid": 4326,
  "address": "康美街道数字经济产业园",
  "classname": "农业产业化企业",
  "classcode": "1700"
}
```

`name` 和 Point `geometry` 必填。`geoid` 可选；不传时在事务级咨询锁保护下按当前最大值加 1 生成，显式传入时若与主键冲突返回 HTTP 409 (`POI_GEOID_CONFLICT`)。旧字段 `id` 不再支持，传入时返回 HTTP 400，避免被静默忽略而造成主键混乱。`objectid` 可选，服务不会自动生成、不做唯一性校验。其他可选字段为 `address/pcode/pname/citycode/cityname/adcode/adname/tel/classname/classcode`。成功返回 `data.item`，包含 `geoid/objectid/name/geometry` 及全部上述业务字段。查询结果也始终返回 `geoid`。

行政区与地址采用“用户输入优先、完全缺失才 lookup”的规则：

- 只要 `address/pcode/pname/citycode/cityname/adcode/adname` 中任一字段包含有效内容，就完全不调用 lookup，所有字段按用户提交值入库，不混合覆盖。
- 上述字段全部为空或未提交时，在开启写事务前用 Point 坐标及请求 `srid` 调用当前路由环境的 lookup；正式 POI 只查 Pro 行政区库，测试 POI 只查 Test 行政区库。
- lookup 必须返回省、市、区县、乡镇、村五级名称；`address` 按五级非空名称直接拼接，例如 `广东省汕头市澄海区凤翔街道信宁社区`。
- `pname/pcode` 保存省名及六位省级行政码（lookup 返回 `44` 时规范为 `440000`）；`cityname` 保存城市名；`adname/adcode` 保存区县名及六位区县行政码（例如 `澄海区/440515`）。
- `citycode` 按现有 POI 表规范表示电话区号而不是四位行政码。lookup 兜底时按 `cityname` 从同环境已有 POI 中选择使用次数最多的非空电话区号，例如汕头市为 `0754`；找不到既有映射时保持空值，绝不把 `4405` 误写为电话区号。
- lookup 是软性兜底：失败、未命中或五级名称不完整时不补行政区和地址，但仍继续新增，不返回 4xx/5xx，也不因 lookup 结果回滚 INSERT。
- 新增成功的 `data.lookupFallbackAttempted` 表示是否尝试过 lookup，`data.lookupFallbackApplied` 表示是否采用了完整 lookup 结果；未采用时可通过 `data.lookupWarning.warningCode/message` 查看原因。

### 6.3 按 geoid 更新

```http
POST {{baseUrl}}/py/poi/update
Content-Type: application/json

{"geoid": 3917977, "name": "修改后的兴趣点名称", "objectid": 12345}
```

`geoid` 必填并用于定位记录，不可修改主键本身；可以修改 `name`、`objectid`、Point `geometry` 或新增接口中的其他业务字段。至少提交一个待修改字段，不存在的 geoid 返回 HTTP 404。

### 6.4 按 geoid 删除

```http
DELETE {{baseUrl}}/py/poi/delete
Content-Type: application/json

{"geoid": 3917977}
```

该操作按 `geoid` 物理删除并返回被删除的完整公开记录；不支持按名称删除。

## 7. 点线面要素管理

### 7.1 导入点、线、面

```http
POST {{baseUrl}}/py/clip_Line_polygon_points/import
Content-Type: application/json

{
  "epsg": 4326,
  "serialno": "TASK-20260816-001",
  "address": "重庆市江津区",
  "beizhu": "接口测试",
  "time": "2026-08-16 18:00:00",
  "pointlist": [
    {
      "type": "Feature",
      "properties": {"name": "测试点A"},
      "geometry": {"type": "Point", "coordinates": [106.26, 29.29]}
    }
  ],
  "linelist": [
    [[106.261, 29.290], [106.264, 29.291]]
  ],
  "polygonlist": [
    [[106.260, 29.290], [106.262, 29.290], [106.262, 29.288], [106.260, 29.288]]
  ]
}
```

三类列表至少一类非空；兼容历史拼写 `ponitlist`。输入可为坐标数组、GeoJSON 几何、Feature 或 FeatureCollection。成功返回 HTTP 200 和 `code=200`；没有提交任何要素属于请求参数错误，返回 HTTP 400 和 `code=400`，不是 404。

### 7.2 查询附近点线面

GET：

```http
GET {{baseUrl}}/py/clip_Line_polygon_points/query?lon=106.26&lat=29.29&epsg=4326&radius=1500
```

POST：

```http
POST {{baseUrl}}/py/clip_Line_polygon_points/query
Content-Type: application/json

{
  "lon": 106.26,
  "lat": 29.29,
  "epsg": 4326,
  "radius": 1500
}
```

`radius` 单位为米，默认 1000。全量查询：

```http
POST {{baseUrl}}/py/clip_Line_polygon_points/query
Content-Type: application/json

{"isAll": true}
```

返回 GeoJSON FeatureCollection。查询无命中仍返回 HTTP 200、`code=200`、`features=[]`。相近的重复查询可能命中进程内缓存，可查看 `meta.cache_hit`。

### 7.3 删除点线面

POST：

```http
POST {{baseUrl}}/py/clip_Line_polygon_points/delete
Content-Type: application/json

{"ids": [101, 102, 99999]}
```

DELETE 同样支持：

```http
DELETE {{baseUrl}}/py/clip_Line_polygon_points/delete
Content-Type: application/json

{"id": 101}
```

`ids` 可为整数数组、逗号分隔字符串或 JSON 数组字符串。响应区分 `deleted_ids` 和 `not_found_ids`。

## 8. 土壤与农业数据

### 8.1 土壤专题图与分级面积

GET：

```http
GET {{baseUrl}}/py/getSoilNPKpng?soiltype=av_n&province=四川省&city=成都市&county=郫都区&street=唐昌镇
```

POST：

```http
POST {{baseUrl}}/py/getSoilNPKpng
Content-Type: application/json

{
  "soiltype": "av_n",
  "province": "四川省",
  "city": "成都市",
  "county": "郫都区",
  "street": "唐昌镇",
  "village": ""
}
```

`soiltype` 必填，兼容 `soilType`。常用值：`av_k/av_n/av_p/av_mo/k/n/p/om/ph/si/se`。历史响应拼写 `pngrul/localtion/adddress` 请按原样读取。

该接口使用 `tableName.soil_NPK`。`getsoil_npk_png&getsoil_npk_area` 中的 `&` 表示两张关联表；该分类没有 `$database`，因此 Test/Pro 分别使用各自环境的默认数据库。

### 8.2 坐标查询土壤栅格

```http
GET {{baseUrl}}/py/api/getSoildataByLngLat?lng=106.55&lat=29.56
```

或：

```http
POST {{baseUrl}}/py/api/getSoildataByLngLat
Content-Type: application/json

{"lng": 106.55, "lat": 29.56}
```

返回包括 `clay/sand/silt/soiltypeid/soiltype/soilclassid/soilclass/subsoiltype`。POST 只读取 JSON。

### 8.3 地块分组

环境路由：Pro=`/py/getplotgroup`，Test=`/py/test/getplotgroup`，UAT=`/py/uat/getplotgroup`。环境由 URL 固定，请求体不接受 `environment`。

```http
POST {{baseUrl}}/py/getplotgroup
Content-Type: application/json

{"landIds": [200739, 200740, 200752]}
```

按区县名和乡镇名分组，返回组编号、中心经纬度、面积合计和地块 ID。

### 8.4 地块组天气

环境路由：Pro=`/py/getplotgroupweather`，Test=`/py/test/getplotgroupweather`，UAT=`/py/uat/getplotgroupweather`。该接口按环境读取 MySQL 天气库，不查 GIS 地块库。

```http
POST {{baseUrl}}/py/getplotgroupweather
Content-Type: application/json

{
  "location": [
    {"groupIdx": 1, "longitude": "106.058550", "latitude": "29.404918"}
  ],
  "startTime": "2026-08-01",
  "stopTime": "2026-08-07"
}
```

`location/startTime/stopTime` 必填。某个分组查询异常时，对应分组数据可能为 `null`。

### 8.5 地块养分

环境路由：Pro=`/py/getplotgroupnutrient`，Test=`/py/test/getplotgroupnutrient`，UAT=`/py/uat/getplotgroupnutrient`。该接口在同一环境内读取 PostGIS 地块库和 MySQL 养分库。

```http
POST {{baseUrl}}/py/getplotgroupnutrient
Content-Type: application/json

{"landIds": [200739, 200740]}
```

返回字段 `silk` 实际代表 `silt`。无数据时部分数值为 `-1`、分类字段为 `null`；处理异常时统一返回数字 HTTP 500 和数字 `code=500`，原历史值可在 `legacyCode` 中保留。

### 8.6 郎酒测区

```http
POST {{baseUrl}}/py/getLangjiu_survey_area
Content-Type: application/json

{"forceRefresh": false}
```

成功时返回带顶层 `code=200` 的 GeoJSON FeatureCollection；`properties` 随数据库实际列变化。注意当前路由用 Python `bool()` 解析 `forceRefresh`，JSON 中应使用真正的布尔值，不要传字符串 `"false"`。

## 9. 空间计算接口

### 9.1 地块边界 DEM 高程

```http
GET {{baseUrl}}/getPlotAltitude?serialno=500156003203F907A9C22E348E6A9928
```

`serialno` 未传时业务代码会使用内置示例编号。唯一命中时返回 GeoJSON，坐标第三维为 DEM 高程；`is_err=1` 表示至少一个点未成功读取高程。指定编号未命中或命中不唯一属于指定业务资源不存在，返回数字 HTTP 404、数字 `code=404` 和字符串 `errorCode=NOT_FOUND`。

### 9.2 附近 Shapefile 要素及质心距离

```http
GET {{baseUrl}}/py/getcentroid?lng=106.55&lat=29.56
```

两个参数都必填且必须是数字。接口依赖部署目录中的 `20250311_zx/tgeoa.shp`，按质心距离升序返回 `data` 数组，顶层 `code=200`。

### 9.3 坐标所在 Shapefile 面

```http
GET {{baseUrl}}/py/getpolygon?lng=106.55&lat=29.56
```

两个参数都必填且必须是数字。接口依赖部署目录中的 `20250318/tgeoa.shp`；空间查询未命中仍返回数字 HTTP 200，响应体为 `{"code":200,"success":false,"message":"..."}`。

### 9.4 轨迹经过地块指标

推荐 JSON：

```http
POST {{baseUrl}}/py/getRtkLatLonTrajectory
Content-Type: application/json

{
  "location": {
    "type": "LineString",
    "coordinates": [[105.934154, 29.841137], [105.938128, 29.837163]]
  },
  "trackTime": "2026-08-16 10:00:00",
  "width": 1.8,
  "IsRemoveOverlap": true
}
```

也支持 WKT Query：

```http
POST {{baseUrl}}/py/getRtkLatLonTrajectory?trackTime=2026-08-16%2010%3A00%3A00&width=1.8&IsRemoveOverlap=true&location=LINESTRING%28107.390531469%2030.371157447%2C107.390573405%2030.371143606%29
```

Query 同名参数优先于 JSON。`location` 支持 GeoJSON 对象、GeoJSON 字符串或 WKT LineString；`trackTime` 格式为 `YYYY-MM-DD HH:mm:ss`；`width` 必须大于 0。轨迹点间隔固定按 1 秒计算。顶层 `code` 仍遵守统一规范；兼容字段成功时 `status=1`，失败时 `status=0`。

接口直接查询 PostGIS，并与 `getPlotBoundary` 使用相同的分环境规则：正式、测试、UAT、Demo 分别调用 `/py/getRtkLatLonTrajectory`、`/py/test/getRtkLatLonTrajectory`、`/py/uat/getRtkLatLonTrajectory`、`/py/demo/getRtkLatLonTrajectory`，读取各自的 `PARCEL_POSTGIS_*` 配置。

PowerShell 使用仓库现成测试数据：

```powershell
$body = Get-Content -LiteralPath 'tests\轨迹test.json' -Raw -Encoding UTF8
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8082/py/getRtkLatLonTrajectory' -ContentType 'application/json; charset=utf-8' -Body $body
```

### 9.5 多作业轨迹汇总

原有单轨迹接口保持不变。批量接口路径为：

| 环境 | 路径 |
| --- | --- |
| Pro | `POST /py/getRtkLatLonTrajectoryByDevs` |
| Test | `POST /py/test/getRtkLatLonTrajectoryByDevs` |
| UAT | `POST /py/uat/getRtkLatLonTrajectoryByDevs` |
| Demo | `POST /py/demo/getRtkLatLonTrajectoryByDevs` |

请求示例：

```http
POST {{baseUrl}}/py/getRtkLatLonTrajectoryByDevs
Content-Type: application/json

{
  "devSn": "设备id",
  "locations": [
    {
      "jobId": "123",
      "location": {
        "type": "LineString",
        "coordinates": [[107.411048, 30.393576], [107.411241, 30.393578]]
      }
    },
    {
      "jobId": "124",
      "location": {
        "type": "LineString",
        "coordinates": [[107.410843, 30.393497], [107.411066, 30.393529]]
      }
    }
  ],
  "trackTime": "2026-08-16 10:00:00",
  "width": 1.8,
  "IsRemoveOverlap": true
}
```

`locations` 必须是非空数组，每项必须包含非空 `jobId` 和有效的二维 GeoJSON/WKT `LineString`。`jobId` 在响应中统一为字符串；同一 `jobId` 可以提交多个互相断开的轨迹段。`devSn` 为调用方设备标识兼容字段，不参与地块空间判断。

服务把多条轨迹作为断开的 `MultiLineString` 查询候选地块，并逐条轨迹确认相交，不会连接相邻作业的终点和起点，因此不会因跨作业连线额外命中地块。同一地块被多条作业命中时只返回一个 `data` 项，其字段与单轨迹接口一致，并增加 `jobIds` 字符串数组；长度即命中该地块的不同作业 ID 数量。长度、面积、速度及覆盖率按命中轨迹汇总；`IsRemoveOverlap=true` 时也会去除不同作业之间的重复覆盖。

成功仍返回 HTTP `200`、数字 `code=200`、`status=1`；请求结构、`jobId` 或任一轨迹无效时返回 HTTP/数字 `code=400`，不执行数据库写入。该接口和原接口都只读地块数据库。

### 9.6 地块聚类凸包

```http
POST {{baseUrl}}/py/getPlotBoundary
Content-Type: application/json

{
  "serialnos": ["PLOT-001", "PLOT-002"],
  "airport": [106.3201, 29.8458],
  "threshold": 100
}
```

`serialnos` 必填且非空，重复值自动去重，默认最多 5000 个；`threshold` 单位为米且不能小于 0。`airport` 为兼容参数，当前聚类核心未使用。成功返回带顶层 `code=200` 的 GeoJSON FeatureCollection。

### 9.7 视锥范围查询地块及处方

接口根据经纬度和朝向角度生成固定范围的视锥区域，查询相交地块，并关联 MySQL 中的农田和处方信息。默认只返回存在处方的地块；设置 `isreturnnull=true` 后会同时返回没有处方的地块。

环境路径固定绑定数据源，请求参数不能切换环境：

| 环境 | 路径 |
| --- | --- |
| Pro | `POST /py/getplotByLonLatangle` |
| Test | `POST /py/test/getplotByLonLatangle` |
| UAT | `POST /py/uat/getplotByLonLatangle` |

Demo 环境未注册该接口。请求体必须是 JSON 对象，也可以把同名参数放在 Query 中；Query 参数会覆盖 JSON 中的同名字段。

```http
POST {{baseUrl}}/py/getplotByLonLatangle
Content-Type: application/json

{
  "lon": 106.484841,
  "lat": 29.638452,
  "angle": 241,
  "limit": 10,
  "isreturnnull": false
}
```

参数：

| 参数 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `lon`/`longitude` | 是 | - | 经度，范围 `[-180, 180]` |
| `lat`/`latitude` | 是 | - | 纬度，范围 `[-90, 90]` |
| `angle` | 否 | `0` | 朝向角度，单位为度；允许范围 `[-360000, 360000]` |
| `sno`/`serialnos` | 否 | 空 | 按地块编号过滤；支持数组或逗号分隔字符串，最多 500 个 |
| `farmlandid`/`farmLandIds` | 否 | 空 | 按农田 ID 过滤；支持数组或逗号分隔字符串，最多 500 个，必须为正整数 |
| `limit` | 否 | `10` | 返回地块数，范围 `1-500` |
| `isreturnnull`/`isReturnNull` | 否 | `false` | 是否保留没有处方的地块，必须为布尔值或 `0/1`、`true/false` |

查询范围固定为以输入点为起点、半径 500 米、角度为 `angle ± 8` 度的视锥区域。成功响应示例：

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "traceId": "2c1f8b6d7d8f4df1a4f0d0b0a3a8c123",
    "isreturnnull": false,
    "aimPlot": [
      {
        "farmlandid": 377305,
        "serialno": "PLOT-001",
        "landname": "示例地块",
        "inarea": 12.5,
        "area": 80.0,
        "distance": 123.4,
        "plantingplanid": 293,
        "prescriptionIds": [293],
        "mysqlFarmLand": {},
        "prescriptions": []
      }
    ],
    "view": {"type": "Polygon", "coordinates": []},
    "radius": 500.0
  },
  "requestId": "client-request-id-or-generated-id",
  "meta": {"environment": "Pro", "elapsedMs": 12.3}
}
```

`aimPlot` 中的地块字段来自 PostGIS；`mysqlFarmLand`、`prescriptionIds` 和 `prescriptions` 来自 MySQL 关联结果。没有匹配地块时 `aimPlot` 为空，通常仍返回 HTTP 200。参数错误返回 HTTP 400、`errorCode=INVALID_ARGUMENT`；数据库错误返回 HTTP 500、`errorCode=DATABASE_ERROR`。可通过请求头 `X-Request-ID` 传入调用方请求 ID，响应中的 `requestId` 会原样返回；未传入时服务自动生成。

### 9.8 路网最短路径

```http
GET {{baseUrl}}/py/getroad?source_lon=121.2546&source_lat=31.0904&target_lon=120.9578&target_lat=31.2811
```

四个参数都必填且必须是数字。接口依赖本地路网 Shapefile，并会覆盖写入项目根目录的 `上海_苏州路径.geojson`。没有可用路径时仍返回数字 HTTP 200，并以 `data.found=false` 表示未命中。

## 10. 建议的全接口测试顺序

1. 先打开 `/py/api/interface-self-test`，对目标环境执行路由注册、HTTP 通达性及数据库表自测。
2. `/py/api/ping`、根路径及无数据库依赖接口。
3. 行政区点查、范围查询和缓存统计。
4. 各只读地块、土壤、农业及空间计算接口。
5. `/py/GengDi/query/*` 查询接口。
6. 点线面接口仅执行只读或模拟验证，除非另有隔离测试任务授权。
7. 通过模拟服务验证四环境 `GengDi` 路径、HTTP 方法及环境绑定。
8. 如必须验证地块写 SQL，仅连接 `onemap_test`，在单一测试事务中依次执行 `create → geometry → update → remove` 后强制回滚。
9. 不对 Pro、UAT、Demo 执行真实写测试；自动化任务不测试物理删除。

禁止使用已有业务记录作为写测试目标，也禁止提交测试事务。由于几何重复会返回 HTTP 409，回滚测试每轮应使用不同且确实位于测试库目标行政村内的 Polygon。

## 11. 常见错误

缺少经纬度（HTTP 状态为数字 400；JSON `code` 是该历史接口保留的数字业务码）：

```json
{"code": 400, "message": "Request body must contain lon(or lng) and lat.", "data": null}
```

GengDi 临时 Token 缺失、无效或过期：

```json
{"code": 401, "errorCode": "WRITE_UNAUTHORIZED", "message": "GengDi access token is invalid or expired", "data": null}
```

范围几何错误：

```json
{"code": 422, "errorCode": "INVALID_GEOMETRY", "message": "Polygon exterior ring must be closed", "data": null}
```

GengDi 数据不存在、重复或正在使用时，重点检查 HTTP 状态以及 `code/message/data`；批量写操作出现任一错误会整体回滚。

## XFTP 文件上传

## `POST /py/docs_xftp_data/token`

使用固定账号密码获取上传 Token，不需要数据库用户表。请求支持 JSON 或 `application/x-www-form-urlencoded`，账号密码不要放在 URL 查询字符串中：

请求示例：

```http
POST http://127.0.0.1:8082/py/docs_xftp_data/token
Content-Type: application/json
```

请求体：

```json
{
  "username": "admin",
  "password": "admin123"
}
```

成功响应的 `data` 包含 `accessToken`、`tokenType=Bearer`、`expiresIn=864000` 和 Unix 时间戳 `expiresAt`。Token 有效期为 10 天；过期后可再次使用固定账号密码获取。

响应示例：

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "accessToken": "<Bearer Token>",
    "tokenType": "Bearer",
    "expiresIn": 864000,
    "expiresAt": 1787817600
  },
  "requestId": "9c1f...",
  "meta": {
    "environment": "Pro",
    "elapsedMs": 1.2
  }
}
```

## `POST /py/docs_xftp_data/upload`

请求使用 `multipart/form-data`：

- `file`：必填，待上传文件。
- `serversFrom`：数据供应商名称，对应数据库字段 `servers_from`，最长 60 个字符；它不参与传输账号或目标目录选择。
- `XFTP_USER_TYPE`：仅 `XFTP_TYPE=net` 时必填，值为 `maptiles` 或 `mvt`。`maptiles` 使用 `liaoliaoftp` 账号及 `/tiff` 默认目录；`mvt` 使用 `gisdata` 账号及 `/MBtiles` 默认目录。该字段只用于选择传输账号和存储目标，不写入 `servers_from`。
- `pathurl`：可选的目标相对子目录。`local` 模式下相对于 `LOCAL_UPLOAD_ROOT_PATH`；`net` 模式下相对于所选 FTP 账号的默认目录。不传时使用对应根目录。目录不存在时返回错误，接口不会自动创建目录。
- `filetype`：可选，默认取文件扩展名。
- `projectname`、`areaname`、`isDocs`、`creater`、`minmaxXY`：可选，对应 `docs_xftp_data` 的业务字段。`isDocs`（是否归档）未传或传空值时默认写入“是”；兼容参数名 `is_docs` 和 `isdocs`。
- `createtime`、`updatetime`：可选，格式为 `YYYY-MM-DD`，默认使用服务器当前日期。
- `X-Request-ID`：可选请求头，只允许字母、数字、点、下划线和短横线。它只是日志追踪标识，如 `tilespy-curl-verify-20260908`，不是错误码或文件数量限制。批量调用可重复使用，但建议每个请求使用唯一值便于排查。
- `Authorization: Bearer <token>`：必填，通过 `/py/docs_xftp_data/token` 获取。兼容使用 `X-XFTP-Upload-Token` 请求头承载同一个签名 Token。

当用户未传 `minmaxXY` 时，服务会尽力从文件空间元数据中解析矩形范围，统一转换为 EPSG:4490，并按 `minX,minY,maxX,maxY` 写入数据库。当前支持：

- GeoJSON（`.geojson`，以及内容为 GeoJSON 的 `.json`）、KML；
- GeoPackage（`.gpkg`），读取第一个图层的范围；
- 包含 `.shp/.shx/.dbf/.prj` 等完整配套文件的 Shapefile ZIP，推荐文件名以 `.shp.zip` 结尾；压缩包中必须恰好只有一个 `.shp` 数据集，存在多个时不自动猜测；
- File Geodatabase 压缩包（`.gdb.zip`），压缩包中必须恰好只有一个 `.gdb` 目录，读取其中第一个图层的范围；
- MBTiles，优先读取 `metadata.bounds`，缺失时根据瓦片行列号计算；
- GeoTIFF/TIFF、IMG、VRT 等带地理参考的栅格；
- 包含 `tilemapresource.xml` 的瓦片 ZIP，以及单独上传的 `tilemapresource.xml`。

当用户未传 `areaname` 且存在有效的 `minmaxXY`（用户传入或自动解析）时，服务会复用 `lookuparea` 范围查询补充行政区文本。用户显式传入的 `minmaxXY`、`areaname` 始终优先，不会被覆盖。文件不受支持、缺少坐标系、元数据损坏或行政区查询无结果时保持相应字段为空，不影响文件上传。

每次使用有效 Token 调用上传或目录查询接口时，响应都会通过 `X-XFTP-Access-Token` 和 `X-XFTP-Token-Expires-At` 返回重新计时 10 天的新 Token；前端应保存新 Token 替换旧值。若 10 天内没有请求，需重新提交固定账号密码获取 Token。

XFTP 接口的数字 HTTP 状态与数字 `code` 始终一致；字符串 `errorCode` 用于前端细分失败原因：

| HTTP 状态及 `code` | 含义 | 常见 `errorCode` |
| --- | --- | --- |
| `200` | 请求成功 | 无 |
| `400` | 参数或请求内容不合法 | `FILE_REQUIRED`、`INVALID_ARGUMENT`、`INVALID_PATHURL`、`TARGET_NOT_DIRECTORY` |
| `401` | Token 无效、过期或固定账号密码错误 | `XFTP_UNAUTHORIZED`、`INVALID_CREDENTIALS` |
| `404` | 指定的本地或远程目录不存在 | `LOCAL_DIRECTORY_NOT_FOUND`、`REMOTE_DIRECTORY_NOT_FOUND`、`TARGET_PATH_NOT_FOUND` |
| `409` | 目标文件已存在且未允许覆盖 | `LOCAL_FILE_EXISTS`、`REMOTE_FILE_EXISTS` |
| `413` | 文件超过大小限制 | `FILE_TOO_LARGE` |
| `415` | 文件扩展名不在允许列表 | `FILE_TYPE_NOT_ALLOWED` |
| `500` | 本服务配置、数据库或未预期的内部异常 | `INVALID_CONFIG`、`XFTP_METADATA_WRITE_FAILED`、`INTERNAL_ERROR` |
| `502` | FTP/FTPS/SFTP 等上游传输服务异常 | `XFTP_UPLOAD_FAILED`、`XFTP_LIST_FAILED` |
| `503` | XFTP 服务被配置为关闭 | `XFTP_DISABLED` |

传输由 `XFTP_TYPE` 完全分流：

- `local`：不读取 FTP 配置、不建立 FTP 连接，直接写入本地保密电脑的 `LOCAL_UPLOAD_ROOT_PATH`。不要求 `XFTP_USER_TYPE`；数据库 `servers_from` 保存请求中的数据供应商、`local_net_type=local`，`pathurl` 保存最终文件的绝对完整路径。
- `net`：通过 `XFTP_USER_TYPE` 选择 FTP 账号，默认使用 FTP 被动模式，也可通过 `XFTP_PROTOCOL=ftps|sftp` 切换协议。FTP/FTPS 控制通道和文件名默认使用 UTF-8，可用 `XFTP_FTP_ENCODING`、`XFTP_MAPTILES_ENCODING` 或 `XFTP_MVT_ENCODING` 调整；仅当旧 FTP 服务端明确使用中文本地编码时才设为 `GB18030`。数据库 `servers_from` 仍保存请求中的数据供应商；`local_net_type` 按目标账号写入 `net:maptiles` 或 `net:mvt`，`pathurl` 保存 FTP/SFTP 最终完整路径。

上传成功后，接口按现有表结构写入 `docs_xftp_data`。每个请求只处理一个 `file`；批量程序需分别调用。同名并发传输的临时文件已使用每次上传唯一的名称相互隔离。文件传输或数据库写入失败时不会新增数据库记录；网络模式下如文件已传输完、但元数据入库失败，返回 `XFTP_METADATA_WRITE_FAILED` 及 `data.fileTransferred=true/remotePath/size/sha256`，调用方不应盲目重传。

数据库环境由服务端 `XFTP_DATABASE_ENVIRONMENT` 固定（默认 `Pro`），连接、schema 和表名统一从 `src/database` 的 `tableName.docsXftpData` 解析，不再读取旧的 `XFTP_DATABASE_NAME*`、`XFTP_DATABASE_SCHEMA`、`XFTP_DATABASE_TABLE`。

`net` 模式请求示例：

```http
POST http://127.0.0.1:8082/py/docs_xftp_data/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

在 Postman 或 Apifox 的 `Body → form-data` 中填写：

> 使用 Postman、Apifox 或浏览器 `FormData` 时让客户端自动生成包含 boundary 的 `Content-Type`，不要手工拼接 multipart boundary。

| 参数 | 类型 | 示例值 |
| --- | --- | --- |
| `file` | File | `map.mbtiles` |
| `serversFrom` | Text | `供应商A` |
| `XFTP_USER_TYPE` | Text | `mvt` |
| `pathurl` | Text | `2026/project-a` |
| `projectname` | Text | `project-a` |
| `areaname` | Text | `重庆市` |
| `creater` | Text | `admin` |
| `minmaxXY` | Text | `105.1,29.1,105.2,29.2` |

`local` 模式请求示例（无需 `XFTP_USER_TYPE`）：

```http
POST http://127.0.0.1:8082/py/docs_xftp_data/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

`Body → form-data`：

| 参数 | 类型 | 示例值 |
| --- | --- | --- |
| `file` | File | `secret.tif` |
| `serversFrom` | Text | `供应商B` |
| `pathurl` | Text | `project-a` |
| `projectname` | Text | `project-a` |
| `creater` | Text | `admin` |

上传成功响应示例：

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "id": 101,
    "name": "secret.tif",
    "filetype": "tif",
    "serversFrom": "供应商B",
    "xftpUserType": null,
    "localNetType": "local",
    "pathurl": "E:\\data\\upload\\project-a\\secret.tif",
    "size": 1048576,
    "sha256": "<64位SHA-256>"
  },
  "requestId": "8a21..."
}
```

## `GET /py/docs_xftp_data/list`

查询目标目录下的文件和文件夹，必须携带与上传接口相同的 Bearer Token。

查询参数：

- `path`：必填，相对于目标根目录的安全路径；使用 `.` 查询根目录。禁止绝对路径和 `..` 越界。
- `targetType`：必填。`XFTP_TYPE=local` 时只能为 `local`；`XFTP_TYPE=net` 时为 `maptiles` 或 `mvt`。兼容参数名 `XFTP_USER_TYPE`、`xftpUserType`。

请求示例：

```http
GET http://127.0.0.1:8082/py/docs_xftp_data/list?path=.&targetType=local
Authorization: Bearer <token>
```

成功时 `data` 包含：

```json
{
  "path": "目标完整路径",
  "targetType": "local",
  "localNetType": "local",
  "count": 2,
  "items": [
    {
      "name": "folder",
      "type": "directory",
      "size": null,
      "modifiedTime": "2026-08-17T06:00:00+00:00",
      "path": "目标完整路径/folder"
    }
  ]
}
```

路径不存在时返回 `LOCAL_DIRECTORY_NOT_FOUND`（本地模式）或 `TARGET_PATH_NOT_FOUND`（网络模式）。目标不是目录时返回 `TARGET_NOT_DIRECTORY`。
