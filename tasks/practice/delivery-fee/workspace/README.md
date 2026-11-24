# Delivery fee

The shop's checkout adds a delivery charge to each order. The promise on the
site is simple: **free delivery on orders of £50 or more**. Every other order
pays the standard £5.00 fee.

A customer complained that a basket of exactly £50.00 was charged for delivery.
Orders above that amount ship free, and smaller orders pay the fee, so the
problem only shows at the promised amount itself.

Repair `delivery_fee` in `shop/delivery.py` so the charge matches the promise.
Keep the function signatures, the £5.00 fee and the £50.00 free-delivery amount.
Amounts are `Decimal` values in pounds.

This is a short starter task. Ask the agent for the change, review what it
proposes, run the public checks, then submit. The submission checks exercise
the amounts around the free-delivery line.
