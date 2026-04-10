const BL_API_URL = 'https://api.baselinker.com/connector.php';

function getToken(): string {
  const token = process.env.BASELINKER_TOKEN;
  if (!token) throw new Error('BASELINKER_TOKEN not set in environment');
  return token;
}

export async function callBaselinker<T = unknown>(
  method: string,
  parameters: Record<string, unknown> = {}
): Promise<T> {
  const token = getToken();

  const body = new URLSearchParams();
  body.set('method', method);
  body.set('parameters', JSON.stringify(parameters));

  const res = await fetch(BL_API_URL, {
    method: 'POST',
    headers: {
      'X-BLToken': token,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`BaseLinker API HTTP error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  if (json.status === 'ERROR') {
    throw new Error(`BaseLinker API error: ${json.error_message} (code: ${json.error_code})`);
  }

  return json as T;
}

// ─── Typed helpers ───
export async function getInventories() {
  const res = await callBaselinker<{ inventories: Record<string, unknown>[] }>('getInventories');
  return res.inventories ?? [];
}

export async function getInventoryWarehouses(inventoryId: number) {
  const res = await callBaselinker<{ warehouses: Record<string, unknown> }>(
    'getInventoryWarehouses',
    { inventory_id: inventoryId }
  );
  return Object.values(res.warehouses ?? {});
}

export async function getInventoryPriceGroups(inventoryId: number) {
  const res = await callBaselinker<{ price_groups: Record<string, unknown> }>(
    'getInventoryPriceGroups',
    { inventory_id: inventoryId }
  );
  return Object.values(res.price_groups ?? {});
}

export async function getInventoryExtraFields() {
  const res = await callBaselinker<{ extra_fields: Record<string, unknown>[] }>(
    'getInventoryExtraFields'
  );
  return res.extra_fields ?? [];
}

export async function getInventoryManufacturers(inventoryId: number) {
  const res = await callBaselinker<{ manufacturers: Record<string, unknown> }>(
    'getInventoryManufacturers',
    { inventory_id: inventoryId }
  );
  return Object.values(res.manufacturers ?? {});
}

export async function getInventoryIntegrations(inventoryId: number) {
  const res = await callBaselinker<{ integrations: unknown[] }>(
    'getInventoryIntegrations',
    { inventory_id: inventoryId }
  );
  return res.integrations ?? [];
}

export async function getInventoryAvailableTextFieldKeys(inventoryId: number) {
  const res = await callBaselinker<{ text_field_keys: string[] }>(
    'getInventoryAvailableTextFieldKeys',
    { inventory_id: inventoryId }
  );
  return res.text_field_keys ?? [];
}

export async function addInventoryProduct(params: Record<string, unknown>) {
  return callBaselinker<{ product_id: number }>('addInventoryProduct', params);
}

export async function getInventoryProductsData(productIds: string[], inventoryId: number) {
  return callBaselinker('getInventoryProductsData', {
    inventory_id: inventoryId,
    products: productIds,
  });
}
