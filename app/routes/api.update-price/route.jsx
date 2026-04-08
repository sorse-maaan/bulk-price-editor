import { authenticate } from "../../shopify.server";

export async function POST({ request }) {
  const { admin } = await authenticate.admin(request);

  const body = await request.json();
  const { variants } = body;

  for (const v of variants) {
    const newPrice = (parseFloat(v.price) * 1.1).toFixed(2);

    await admin.graphql(`
      mutation {
        productVariantUpdate(input: {
          id: "${v.variantId}",
          price: "${newPrice}"
        }) {
          userErrors {
            message
          }
        }
      }
    `);
  }

  return new Response(JSON.stringify({ success: true }));
}