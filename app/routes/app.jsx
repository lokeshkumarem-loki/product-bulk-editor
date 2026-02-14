import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { Frame, AppProvider as PolarisAppProvider } from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <ShopifyAppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={polarisTranslations}>
        <Frame>
          <s-app-nav>
            <s-link href="/app/product_tag">Product tag</s-link>
            <s-link href="/app/add_discount_price">Add discount price</s-link>
            <s-link href="/app/remove_discount_price">
              Remove discount price
            </s-link>
            <s-link href="/app/create_metafield">Create metafield</s-link>
            <s-link href="/app/add_metafield">Update metafield</s-link>
          </s-app-nav>
          <Outlet />
        </Frame>
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
