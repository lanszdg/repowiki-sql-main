CREATE OR REPLACE PACKAGE BODY INVENTORY_PKG AS
  PROCEDURE bulk_receive(p_item_id IN NUMBER, p_qty IN NUMBER, p_result OUT VARCHAR2) IS
    v_status VARCHAR2(8);
  BEGIN
    IF p_item_id IS NULL THEN
      RAISE_APPLICATION_ERROR(-20001, 'item required');
    END IF;

    v_status := CONST_PKG.STATUS_OK;
    FORALL i IN 1..1
      INSERT INTO INV_TXN(ID, ITEM_ID, QTY, STATUS)
      VALUES (INV_TXN_SEQ.NEXTVAL, p_item_id, p_qty, v_status);

    INSERT INTO INV_AUDIT(ITEM_ID, ACTION) VALUES (p_item_id, UTIL_PKG.get_param('receive'));
    COMMIT;
    p_result := 'OK';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE;
  END bulk_receive;

  FUNCTION get_stock(p_item_id IN NUMBER) RETURN NUMBER IS
    v_qty NUMBER;
  BEGIN
    SELECT QTY INTO v_qty FROM INV_TXN WHERE ITEM_ID = p_item_id;
    RETURN v_qty;
  END get_stock;
END INVENTORY_PKG;
/
