CREATE OR REPLACE PACKAGE BODY INVENTORY_PKG AS
  PROCEDURE bulk_receive(p_item_id IN NUMBER, p_qty IN NUMBER, p_result OUT VARCHAR2) IS
  BEGIN
    FORALL i IN 1..1
      INSERT INTO INV_TXN(ITEM_ID, QTY) VALUES (p_item_id, p_qty);
    INSERT INTO INV_AUDIT(ITEM_ID, ACTION) VALUES (p_item_id, 'receive');
  END bulk_receive;

  FUNCTION get_stock(p_item_id IN NUMBER) RETURN NUMBER IS
  BEGIN
    RETURN 0;
  END get_stock;
END INVENTORY_PKG;
/
