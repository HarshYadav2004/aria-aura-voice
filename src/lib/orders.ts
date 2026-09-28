export type OrderStatus =
  | "Processing"
  | "Shipped"
  | "Out for Delivery"
  | "Delivered";

export type Order = {
  order_id: string;
  customer: string;
  product: string;
  value: string;
  status: OrderStatus;
  notes: string;
  courier?: string;
  tracking_id?: string;
  eta?: string;
  delivered_ago?: string;
  ordered_ago?: string;
  cancellation_eligible: boolean;
};

const ORDERS: Record<string, Order> = {
  "ORD-101": {
    order_id: "ORD-101",
    customer: "Priya Sharma",
    product: "Vitamin C Serum (30ml)",
    value: "₹699",
    status: "Out for Delivery",
    notes: "Expected by 6 PM today",
    courier: "BlueDart",
    tracking_id: "BD-982103",
    eta: "by 6 PM today",
    cancellation_eligible: false,
  },
  "ORD-102": {
    order_id: "ORD-102",
    customer: "Rahul Verma",
    product: "Hydrating Sunscreen SPF 50",
    value: "₹499",
    status: "Delivered",
    notes: "Delivered 14 days ago",
    courier: "Delhivery",
    tracking_id: "DL-441029",
    delivered_ago: "14 days ago",
    cancellation_eligible: false,
  },
  "ORD-103": {
    order_id: "ORD-103",
    customer: "Ananya Patel",
    product: "Green Tea Face Wash + Toner",
    value: "₹850",
    status: "Processing",
    notes: "Ordered 3 hours ago. Eligible for cancellation",
    ordered_ago: "3 hours ago",
    cancellation_eligible: true,
  },
};

export const SAMPLE_ORDERS = Object.values(ORDERS);

export function normalizeOrderId(raw: string): string {
  const cleaned = raw.trim().toUpperCase();
  const match = cleaned.match(
    /\b(?:ORD|ORDER(?:\s*ID)?|ID)\s*(?:IS\s*)?-?\s*(\d+)\b/,
  );
  if (match) return `ORD-${match[1]}`;
  if (/^\d+$/.test(cleaned)) return `ORD-${cleaned}`;
  return raw.trim();
}

export function getOrderDetails(orderId: string): Order | { error: string } {
  const id = normalizeOrderId(orderId);
  const order = ORDERS[id];
  if (!order) {
    return {
      error: `No order found for ID ${id}. Ask the customer to verify the order ID.`,
    };
  }
  return order;
}
