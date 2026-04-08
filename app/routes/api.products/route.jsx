import { authenticate } from "../../shopify.server";

export async function GET({ request }) {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`
    query {
      products(first: 10) {
        edges {
          node {
            title
            variants(first: 5) {
              edges {
                node {
                  id
                  price
                }
              }
            }
          }
        }
      }
    }
  `);

  const data = await response.json();

  const products = data.data.products.edges.flatMap((p) =>
    p.node.variants.edges.map((v) => ({
      productTitle: p.node.title,
      variantId: v.node.id,
      price: v.node.price,
    }))
  );

  return new Response(JSON.stringify({ products }));
}