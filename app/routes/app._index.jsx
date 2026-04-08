import { useLoaderData, Form, useNavigation, useActionData, useSubmit } from "react-router-dom";
import { useMemo, useEffect, useState } from "react";
import { authenticate } from "../shopify.server";
import {
  Page,
  Layout,
  Card,
  Button,
  AppProvider,
  TextField,
  ChoiceList,
  Select,
  BlockStack,
  Text,
  Banner, 
  Frame, 
  Toast, 
  Spinner,
  Autocomplete,
  Checkbox
} from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
];

// --------------------
// Helpers
// --------------------
async function fetchAllStoreVariants(admin) {
  const allVariants = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const response = await admin.graphql(
      `
        query GetProducts($cursor: String) {
          products(first: 50, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                title
                variants(first: 100) {
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
      `,
      { variables: { cursor } },
    );

    const data = await response.json();
    const products = data?.data?.products;

    if (!products) break;

    const pageVariants = products.edges.flatMap((p) =>
      p.node.variants.edges.map((v) => ({
        productId: p.node.id,
        productTitle: p.node.title,
        variantId: v.node.id,
        price: v.node.price,
      })),
    );

    allVariants.push(...pageVariants);
    hasNextPage = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;
  }

  return allVariants;
}

async function fetchCollectionVariants(admin, collectionIds) {
  const allVariants = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const response = await admin.graphql(
      `
        query GetCollectionProducts($collectionIds: ID!, $cursor: String) {
          collection(id: $collectionIds) {
            id
            title
            products(first: 50, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  id
                  title
                  variants(first: 100) {
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
        }
      `,
      { variables: { collectionIds, cursor } },
    );

    const data = await response.json();
    const collection = data?.data?.collection;

    if (!collection?.products) break;

    const pageVariants = collection.products.edges.flatMap((p) =>
      p.node.variants.edges.map((v) => ({
        productId: p.node.id,
        productTitle: p.node.title,
        variantId: v.node.id,
        price: v.node.price,
      })),
    );

    allVariants.push(...pageVariants);
    hasNextPage = collection.products.pageInfo.hasNextPage;
    cursor = collection.products.pageInfo.endCursor;
  }

  return allVariants;
}

function groupVariantsByProduct(variants) {
  return variants.reduce((acc, variant) => {
    if (!acc[variant.productId]) {
      acc[variant.productId] = [];
    }
    acc[variant.productId].push(variant);
    return acc;
  }, {});
}

// --------------------
// LOADER
// --------------------
export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`
    query InitialData {
      products(first: 20) {
        edges {
          node {
            id
            title
            featuredImage {
              url
            }
            variants(first: 20) {
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
      collections(first: 50) {
        edges {
          node {
            id
            title
          }
        }
      }
    }
  `);

  const data = await response.json();

  const products =
    data?.data?.products?.edges.flatMap((p) =>
      p.node.variants.edges.map((v) => ({
        productId: p.node.id,
        productTitle: p.node.title,
        variantId: v.node.id,
        price: v.node.price,
      })),
    ) || [];

  const productOptions = data.data.products.edges.map((p) => ({
  label: p.node.title,
  value: p.node.id,
  image: p.node.featuredImage?.url,
}));

  const collectionOptions = [
    { label: "Select catalog", value: "" },
    ...((data?.data?.collections?.edges || []).map((c) => ({
      label: c.node.title,
      value: c.node.id,
    })) || []),
  ];

  return { products, productOptions, collectionOptions };
}

// --------------------
// ACTION
// --------------------
export async function action({ request }) {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();

  const percent = parseFloat(formData.get("percent")) || 0;
  const mode = formData.get("mode");
  const target = formData.get("target");
  const collectionIds = JSON.parse(formData.get("collectionIds") || "[]");
  const selectedProductIds = JSON.parse(formData.get("selectedProductIds") || "[]");
  const postedVariants = JSON.parse(formData.get("variants") || "[]");

  if (percent < 0 || percent > 500) {
    return { error: "Invalid percent" };
  }

  const multiplier = mode === "decrease" ? 1 - percent / 100 : 1 + percent / 100;

  let variantsToUpdate = [];

  if (target === "all") {
    variantsToUpdate = await fetchAllStoreVariants(admin);
  } else if (target === "collection") {
  if (!collectionIds.length) {
    return { error: "Select at least one collection" };
  }

  variantsToUpdate = [];

  for (const id of collectionIds) {
    const variants = await fetchCollectionVariants(admin, id);
    variantsToUpdate.push(...variants);
  }

  // прибираємо дублікати
  const uniqueMap = new Map();
  for (const v of variantsToUpdate) {
    uniqueMap.set(v.variantId, v);
  }

  variantsToUpdate = Array.from(uniqueMap.values());
} else if (target === "products") {
    if (!selectedProductIds.length) {
      return { error: "Select at least one product" };
    }

    variantsToUpdate = postedVariants.filter((v) =>
      selectedProductIds.includes(v.productId),
    );
  }

  const grouped = groupVariantsByProduct(variantsToUpdate);

const promises = Object.entries(grouped).map(
  async ([productId, variants]) => {
    const variantInputs = variants.map((v) => {
      const basePrice = parseFloat(v.price);
      const newPrice = (basePrice * multiplier).toFixed(2);
      const compareAtPrice = (parseFloat(newPrice) * 1.1).toFixed(2);

      return {
        id: v.variantId,
        price: newPrice,
        compareAtPrice,
      };
    });

    const response = await admin.graphql(
      `
        mutation UpdateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          productId,
          variants: variantInputs,
        },
      },
    );

    const result = await response.json();
    const userErrors =
      result?.data?.productVariantsBulkUpdate?.userErrors || [];

    if (userErrors.length) {
      console.error("Variant update error:", userErrors);
    }
  }
);

await Promise.all(promises);

return Response.json({ success: true, timestamp: Date.now() });
}

// --------------------
// UI
// --------------------
export default function Index() {
  const { products, productOptions, collectionOptions } = useLoaderData();

  const [percent, setPercent] = useState("10");
  const [mode, setMode] = useState(["increase"]);
  const [target, setTarget] = useState(["all"]);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState([]);
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const navigation = useNavigation();
const isLoading = navigation.state === "submitting";
const actionData = useActionData();
const [toast, setToast] = useState(null);
const [searchValue, setSearchValue] = useState("");
const [options, setOptions] = useState([]);
const [loadingSearch, setLoadingSearch] = useState(false);
const submit = useSubmit();

const handleSelectProduct = (selected) => {
  const lastSelected = selected[selected.length - 1];

  if (selectedProductIds.includes(lastSelected)) {
    // remove
    setSelectedProductIds(
      selectedProductIds.filter((id) => id !== lastSelected)
    );
  } else {
    // add
    setSelectedProductIds([...selectedProductIds, lastSelected]);
  }
};

const handleSearch = (value) => {
  setSearchValue(value);

  if (!value) {
    setOptions([]);
    return;
  }

const filtered = productOptions
  .filter((p) =>
    p.label.toLowerCase().includes(value.toLowerCase())
  )
  .slice(0, 10)
  .map((p) => ({
    label: p.label,
    value: p.value,
    image: p.image,
  }));

  setOptions(filtered);
};

// показ success / error
useEffect(() => {
  if (actionData?.success) {
    setToast({ content: "Prices updated successfully", error: false });
  }

  if (actionData?.error) {
    setToast({ content: actionData.error, error: true });
  }
}, [actionData]);

const dismissToast = () => setToast(null);

  const filteredRows = useMemo(() => {
    if (target[0] === "products" && selectedProductIds.length > 0) {
      return products.filter((p) => selectedProductIds.includes(p.productId));
    }

    return products;
  }, [products, target, selectedProductIds]);

  return (
    <AppProvider i18n={enTranslations}>
      <Frame>
      {toast && (
  <Toast
    content={toast.content}
    error={toast.error}
    onDismiss={dismissToast}
  />
)}
      {isLoading && (
  <div
    style={{
      position: "fixed",
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      background: "rgba(255,255,255,0.7)",
      backdropFilter: "blur(3px)",
      zIndex: 9999,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
    }}
  >

  <div className="overlay" style={{textAlign: "center"}}>
    <div className="overlay-box">
      <Spinner size="large" />
      <div style={{ marginTop: 12 }}>
        Updating prices...
      </div>
    </div>
  </div>
  </div>
)}

      <div className="app-container" style={{marginBottom: "40px"}}>
      <Page title="Price Manager">
        <Layout>
          <Layout.Section>
            <Card className="custom-card">
              <BlockStack gap="400">

                {actionData?.success && (
  <Banner tone="success">
    Prices updated successfully
  </Banner>
)}

{actionData?.error && (
  <Banner tone="critical">
    {actionData.error}
  </Banner>
)}

{isLoading && (
  <Banner tone="info">
    Updating prices… please wait
  </Banner>
)}

                  <input
                    type="hidden"
                    name="variants"
                    value={JSON.stringify(products)}
                  />
                  <input
                    type="hidden"
                    name="percent"
                    value={percent}
                  />
                  <input
                    type="hidden"
                    name="mode"
                    value={mode[0]}
                  />
                  <input
                    type="hidden"
                    name="target"
                    value={target[0]}
                  />
                  <input
  type="hidden"
  name="collectionIds"
  value={JSON.stringify(selectedCollectionIds)}
/>
                  <input
                    type="hidden"
                    name="selectedProductIds"
                    value={JSON.stringify(selectedProductIds)}
                  />

                  <BlockStack gap="400">
                    <ChoiceList
                      title="Apply to"
                      choices={[
                        { label: "All store", value: "all" },
                        { label: "Catalog (collection)", value: "collection" },
                        { label: "Products", value: "products" },
                      ]}
                      selected={target}
                      onChange={setTarget}
                    />

                    {target[0] === "collection" && (
                      <ChoiceList
  title="Select catalogs"
  allowMultiple
  choices={collectionOptions.filter((c) => c.value !== "")}
  selected={selectedCollectionIds}
  onChange={setSelectedCollectionIds}
/>
                    )}

{selectedProductIds.length > 0 && (
  <Text as="p" tone="subdued">
    Selected: {selectedProductIds.length} products
  </Text>
)}
{target[0] === "products" && (
  <BlockStack gap="300">
    
    <TextField
      label="Search products"
      value={searchValue}
      onChange={handleSearch}
      autoComplete="off"
      placeholder="Start typing..."
    />

    {options.length > 0 && (
      <div style={{
        border: "1px solid #e1e3e5",
        borderRadius: 8,
        padding: 10,
        maxHeight: 250,
        overflowY: "auto",
        background: "white"
      }}>
        <BlockStack gap="200">
          {options.map((option) => {
            const checked = selectedProductIds.includes(option.value);

            return (
              <Checkbox
                key={option.value}
                label={
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "10px"
    }}>
      {option.image && (
        <img
          src={option.image}
          alt=""
          style={{
            width: 32,
            height: 32,
            objectFit: "cover",
            borderRadius: 4
          }}
        />
      )}
      <span>{option.label}</span>
    </div>
  }
                checked={checked}
                onChange={() => {
                  if (checked) {
                    setSelectedProductIds(
                      selectedProductIds.filter(id => id !== option.value)
                    );
                  } else {
                    setSelectedProductIds([
                      ...selectedProductIds,
                      option.value
                    ]);
                  }
                }}
              />
            );
          })}
        </BlockStack>
      </div>
    )}
  </BlockStack>
)}

                    <ChoiceList
                      title="Change type"
                      choices={[
                        { label: "Increase", value: "increase" },
                        { label: "Decrease", value: "decrease" },
                      ]}
                      selected={mode}
                      onChange={setMode}
                    />

                    <TextField
                      label="Percent (%)"
                      type="text"
                      value={percent}
                      onChange={setPercent}
                      autoComplete="off"
                    />

                    <Text as="p" tone="subdued">
                      Compare-at price will always be 10% higher than the final price.
                    </Text>

                    <Text as="p" tone="subdued">
  You are about to {mode[0]} prices by {percent || 0}%
</Text>

                    <Button
  variant="primary"
  onClick={() => {
    const formData = new FormData();

    formData.append("variants", JSON.stringify(products));
    formData.append("percent", percent);
    formData.append("mode", mode[0]);
    formData.append("target", target[0]);
    formData.append("collectionIds", JSON.stringify(selectedCollectionIds));
    formData.append("selectedProductIds", JSON.stringify(selectedProductIds));

    submit(formData, { method: "post" });
  }}
>
  {mode[0] === "increase" ? "Increase prices" : "Decrease prices"}
</Button>
                  </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </div>
  </Frame>
    </AppProvider>
  );
}