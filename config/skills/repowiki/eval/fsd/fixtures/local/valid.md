# FSD - INVENTORY_PKG.bulk_receive

## 概览
### 存储过程功能
### 参数清单与 Java 类型映射
### 转换策略
### 签名
### 输入类型定义
- FactId: INVENTORY_PKG.bulk_receive
- Package: INVENTORY_PKG
- Subprogram: bulk_receive
- Kind: PROCEDURE
- Signature: PROCEDURE bulk_receive(p_item_id IN NUMBER)
- Param: p_item_id | IN | NUMBER | BigDecimal
- Return: None

## 表结构映射
### 涉及的表清单
### 列 → DO 字段映射
### 跨表关系
### 特殊列处理
- Table: INV_TXN
  - Operations: INSERT
  - Operation: INV_TXN.INSERT
  - Columns: ITEM_ID
  - Column: INV_TXN.ITEM_ID

## 依赖分析
### 调用的其他子程序
### 被其他子程序调用
### 跨包调用 → Service 注入
### 序列依赖
### 常量依赖
- Call: UTIL_PKG.get_param
- Sequence: INV_TXN_SEQ
- Constant: CONST_PKG.STATUS_OK

## 业务规则
### 校验规则
### 计算逻辑
### 状态流转
### 边界条件
- ManualReview: review-forall-1 -> forall-1 (medium)
  - Reason: FORALL requires migration review

## 控制流与异常
### 流程图
### 分支逻辑
### 循环结构
### 异常处理
- Transaction: commit=false, rollback=false, savepoint=false, autonomous=false
- None

## 特殊语法转化规约
### 转化映射
### 事务边界
### 需手动审查的构造
- Syntax: forall-1 | FORALL | risk=medium
- SourceTrace: pkg/inventory_pkg.sql:1-80
