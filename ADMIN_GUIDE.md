# Rainbow Gold Covering — Staff and Owner Product Guide

**New owner screen:** `https://rainbowgoldcovering.com/admin/owner.html` (after the release is deployed).

## Before you start (one-time setup)
The developer must first apply `supabase/migrations/20261110213000_owner_quick_publish.sql` to the existing Supabase project, test the catalogue on a safe staging site, then deploy the owner page. Until that happens, keep using the existing admin site.

## Sign in
1. On your phone, open the owner link above.
2. Sign in using **your existing shop admin username/email and password**. All active shop staff may open the quick catalogue. Admins can publish and manage online stock; inventory staff can prepare drafts and shop opening stock; cashiers may view.
3. Open the top-left **☰** menu to switch between Dashboard, Products, Add Product and Categories. On a computer, use the left menu.

## Add and publish a product
1. Tap **＋ Add Product**.
2. Tap **Camera or gallery**. Choose up to **6 genuine product photos**. The first is the cover photo; use ← or → to reorder and × to remove.
3. Type the **product name**, choose a **category**, add a description and enter the **price in rupees**. The product code is created automatically unless you supply one.
4. Enter **Online stock** and choose which **physical shop** is providing the pieces. Only enter stock that you actually have and have set aside for online sales; tick the confirmation box. If the pieces are already recorded at a shop, edit a draft or use Inventory rather than recording them again.
5. Tap **Publish now**. The app saves the product and transfers the specified pieces to **Online Store** using the existing stock system. When confirmed, tap **View on store**. Tap **Add another** to create the next product with the same category.

**Not ready to publish?** Tap **Save as draft** instead. Drafts are hidden from public shopping and can be completed from **Products** later.

## Change a product
- Open **Products**, search by name or code, then tap **Edit**. Change the price, description, photos or relevant details and save.
- You can change the online price and stock directly on a published one-variant product. Online stock is always transferred to or from an actual physical shop; it is not a free-number adjustment.
- Tap **Unpublish** to hide it. Available online pieces return to the selected shop. If a checkout has reserved pieces, finish or expire that checkout first.
- Use **Duplicate** to copy a design without copying its stock. **Archive** hides a product while preserving its history. **Restore as draft** brings an archived design back for review.

## If your product is not appearing
Check that it has **a photo, price above ₹0, a published listing and available Online Store stock**. The dashboard shows published-but-out-of-stock products. Physical-shop stock alone is not online availability. Use **Inventory** to resolve transfers or reservations. If the screen reports insufficient stock, do not invent quantities—check the actual shop inventory.

## Categories and Salesforce
Admins can use **Categories** to add, rename or reorder categories. Inventory staff can view categories and select existing ones for drafts. A category cannot be deleted while products use it. Salesforce is **not connected** to this shop and is not needed to publish products.

## Safety
Never share your admin password. Do not press Publish twice while a save is in progress. If your connection drops, return to **Products** and check for the newly saved code before attempting another product. Customer payments are handled separately by the existing verified Razorpay checkout system.

**Help:** The **Quick Products** link is available in the shared staff menu alongside Billing, Inventory, Orders and Customers. The original detailed Products and Inventory screens remain available for advanced stock and variant operations.
