import http from 'node:http';

const port = Number(process.env.PORT || 3000);
const bestBuyHeaders = {
  accept: 'application/json',
  'accept-language': 'en-CA,en;q=0.9',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
};
const json = (response, status, body) => response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' }).end(JSON.stringify(body));
const validCode = (code) => /^\d{6,12}$/.test(code || '');
const validPostal = (postal) => /^[A-Z]\d[A-Z][ -]?\d[A-Z]\d$/i.test(postal || '');

function normalize(product, availability) {
  const shipping = availability?.shipping || {}, stock = product.availability || {};
  return {
    webCode: String(product.sku), name: product.name, price: product.salePrice ?? null,
    regularPrice: product.regularPrice ?? null, image: product.thumbnailImage ?? null,
    url: product.productUrl?.startsWith('http') ? product.productUrl : `https://www.bestbuy.ca${product.productUrl || `/en-ca/product/${product.sku}`}`,
    onlineAvailable: shipping.purchasable ?? (stock.isAvailableOnline === true || stock.onlineAvailability === 'InStock'),
    onlineQuantity: shipping.quantityRemaining ?? stock.onlineAvailabilityCount ?? null,
    onlinePurchaseLimit: shipping.orderLimit ?? null,
    onlineStatus: shipping.status || stock.onlineAvailability || 'Unknown',
    storeStatus: stock.inStoreAvailabilityText || 'Confirm on Best Buy', pickupAvailable: product.isAvailableForPickup === true,
  };
}

async function getProduct(webCode, postalCode) {
  const availabilityUrl = `https://www.bestbuy.ca/ecomm-api/availability/products?${new URLSearchParams({ accept: 'application/vnd.bestbuy.standardproduct.v1+json', 'accept-language': 'en-CA', postalCode: postalCode.replace(/\s/g, ''), skus: webCode })}`;
  const [productResponse, availabilityResponse] = await Promise.all([
    fetch(`https://www.bestbuy.ca/api/v2/json/product/${webCode}`, { headers: bestBuyHeaders }),
    fetch(availabilityUrl, { headers: bestBuyHeaders }).catch(() => null),
  ]);
  if (!productResponse.ok) throw new Error(`Best Buy returned HTTP ${productResponse.status}`);
  const product = await productResponse.json();
  let availability = null;
  if (availabilityResponse?.ok) availability = JSON.parse((await availabilityResponse.text()).replace(/^\uFEFF/, '')).availabilities?.[0] ?? null;
  return normalize(product, availability);
}

async function searchProducts(query) {
  const response = await fetch(`https://www.bestbuy.ca/api/v2/json/search?${new URLSearchParams({ query })}`, { headers: bestBuyHeaders });
  if (!response.ok) throw new Error(`Best Buy returned HTTP ${response.status}`);
  return (await response.json()).products?.slice(0, 6).map((product) => ({ webCode: String(product.sku), name: product.name, price: product.salePrice ?? null })) || [];
}

http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname === '/health') return json(response, 200, { ok: true });
    if (url.pathname === '/api/search') {
      const query = url.searchParams.get('query')?.trim() || '';
      if (query.length < 2) return json(response, 400, { error: 'Enter at least two characters.' });
      return json(response, 200, { products: await searchProducts(query) });
    }
    if (url.pathname === '/api/product') {
      const webCode = url.searchParams.get('webCode')?.trim(), postalCode = url.searchParams.get('postalCode')?.trim();
      if (!validCode(webCode) || !validPostal(postalCode)) return json(response, 400, { error: 'Enter a valid Web Code and Canadian postal code.' });
      return json(response, 200, await getProduct(webCode, postalCode));
    }
    return json(response, 404, { error: 'Not found.' });
  } catch (error) { return json(response, 502, { error: error.message || 'Best Buy request failed.' }); }
}).listen(port, '0.0.0.0', () => console.log(`Best Buy direct backend listening on ${port}`));
