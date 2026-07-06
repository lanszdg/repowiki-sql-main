# FSD - PLSCOPE_HELPER.show_identifiers_in

## 概览
### 存储过程功能
### 参数清单与 Java 类型映射
### 转换策略
### 签名
### 输入类型定义
- FactId: PLSCOPE_HELPER.show_identifiers_in
- Package: PLSCOPE_HELPER
- Subprogram: show_identifiers_in
- Kind: PROCEDURE
- Signature: PROCEDURE show_identifiers_in(owner_in IN VARCHAR2, name_in IN VARCHAR2, identifier_filter_in IN VARCHAR2, usage_type_in IN VARCHAR2)
- Param: owner_in | IN | VARCHAR2 | String
- Param: name_in | IN | VARCHAR2 | String
- Param: identifier_filter_in | IN | VARCHAR2 | String
- Param: usage_type_in | IN | VARCHAR2 | String
- Return: None

## 表结构映射
### 涉及的表清单
### 列 → DO 字段映射
### 跨表关系
### 特殊列处理
- Table: USER_IDENTIFIERS
  - Operations: SELECT
  - Operation: USER_IDENTIFIERS.SELECT
  - Columns: OBJECT_NAME
  - Column: USER_IDENTIFIERS.OBJECT_NAME

## 依赖分析
### 调用的其他子程序
### 被其他子程序调用
### 跨包调用 → Service 注入
### 序列依赖
### 常量依赖
- None

## 业务规则
### 校验规则
### 计算逻辑
### 状态流转
### 边界条件
- None

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
- None
- SourceTrace: plsql/code-analysis/plscope-helper-package.sql:1273-1282
