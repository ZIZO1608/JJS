
### GET /system/app-settings
{"defaultCurrency":"USD","loyalty":{"enabled":true,"buyQty":100,"freeQty":5},"orders":{"defaultDeliveryFee":0,"allowStacking":false,"defaultPaymentTermsDays":7,"defaultReturnAction":"waste"},"costing":{"targetMarginPct":40,"priceAlertPct":5},"printing":{"receiptWidthMm":80,"labelWidthMm":50,"labelHeightMm":30,"receiptFooterAr":"شكراً لكم","receiptFooterEn":"Thank you","invoiceSize":"thermal"},"business":{"nameAr":"جي جيز","nameEn":"JJ's Kitchen","phone":"","address":"","logo":""}}

### GET /menu/catalog
{"categories":[{"id":"<id>","nameAr":"ساندويشات","nameEn":"Sandwiches","sort":0,"active":true},"…3 items"],"products":[{"id":"<id>","categoryId":"<id>","code":"CAESAR","nameAr":"سلطة سيزر","nameEn":"Caesar Salad","price":3,"currency":"USD","shelfLifeHours":12,"allergens":"Dairy, Gluten","photo":"","sort":0,"active":true,"weightG":220,"extraCostUsd":0,"groupIds":[]},"…8 items"],"groups":[{"id":"<id>","nameAr":"إضافات","nameEn":"Extras","minSelect":0,"maxSelect":4,"sort":0,"options":[{"id":"<id>","groupId":"<id>","nameAr":"حشوة مضاعفة","nameEn":"Double filling","priceDelta":1,"currency":"USD","sort":0,"active":true},"…3 items"]},"…3 items"]}

### GET /menu/categories
{"rows":[{"id":"<id>","nameAr":"ساندويشات","nameEn":"Sandwiches","sort":0,"active":true},"…3 items"]}

### GET /menu/option-groups
{"rows":[{"id":"<id>","nameAr":"إضافات","nameEn":"Extras","minSelect":0,"maxSelect":4,"sort":0},"…3 items"]}

### GET /menu/options?groupId=01a15bc7-eb13-7273-98dc-e8b258943528
{"rows":[{"id":"<id>","groupId":"<id>","nameAr":"حشوة مضاعفة","nameEn":"Double filling","priceDelta":1,"currency":"USD","sort":0,"active":true},"…3 items"]}

### GET /menu/options/01a15bc7-eb13-7273-98dc-f2adadad84c3/recipe
{"recipe":[{"itemId":"<id>","qty":0.08,"wastePct":0,"nameAr":"صدر حبش","nameEn":"Turkey breast","kind":"ingredient","unitCode":"kg","avgCostUsd":9}]}

### GET /menu/products
{"rows":[{"id":"<id>","categoryId":"<id>","code":"CAESAR","nameAr":"سلطة سيزر","nameEn":"Caesar Salad","price":3,"currency":"USD","shelfLifeHours":12,"allergens":"Dairy, Gluten","photo":"","sort":0,"active":true,"weightG":220,"extraCostUsd":0,"itemId":"<id>","minLevel":0,"ownGroupIds":[],"groupIds":[],"recipe":[{"itemId":"<id>","qty":0.15,"wastePct":0,"nameAr":"خس روماني","nameEn":"Romaine","kind":"ingredient","unitCode":"kg","avgCostUsd":1.4},"…6 items"],"costUsd":1.055,"extraCost":0},"…8 items"]}

### GET /stock/warehouses
{"rows":[{"id":"<id>","nameAr":"برّاد 1","nameEn":"Fridge 1","kind":"fridge","sort":0,"active":true},"…4 items"]}

### GET /stock/locations
{"rows":[{"id":"<id>","warehouseId":"<id>","nameAr":"الرف العلوي","nameEn":"Top shelf","active":true},"…7 items"]}

### GET /stock/items
{"rows":[{"id":"<id>","kind":"ingredient","productId":null,"nameAr":"باتي لحم","nameEn":"Beef patty","unitId":null,"unitCode":"pc","packUnit":"Box","packSize":20,"supplierId":null,"minLevel":20,"avgCostUsd":0.9,"active":true,"qty":60,"valueUsd":54,"low":false},"…28 items"]}

### GET /stock/batches
{"rows":[{"id":"<id>","itemId":"<id>","locationId":"<id>","batchCode":"R-1021-02","producedAt":"2026-10-21T00:06:31.196Z","expiresAt":"2026-10-21T20:59:00.000Z","qtyIn":2,"qtyLeft":2,"unitCostUsd":1.663,"runId":null,"status":"today","item":{"id":"<id>","kind":"product","nameAr":"كلوب حبش مدخّن","nameEn":"Smoked Turkey Club","unitCode":"pc","productId":"<id>"},"location":{"id":"<id>","nameAr":"الرف العلوي","nameEn":"Top shelf"},"warehouse":{"id":"<id>","nameAr":"برّاد 1","nameEn":"Fridge 1","kind":"fridge"},"allergens":"Gluten, Dairy, Egg","productCode":"CLUB"},"…24 items"]}

### GET /stock/scan/R-1021-02
{"kind":"batch","batch":{"id":"<id>","itemId":"<id>","locationId":"<id>","batchCode":"R-1021-02","producedAt":"2026-10-21T00:06:31.196Z","expiresAt":"2026-10-21T20:59:00.000Z","qtyIn":2,"qtyLeft":2,"unitCostUsd":1.663,"runId":null,"status":"today","item":{"id":"<id>","kind":"product","nameAr":"كلوب حبش مدخّن","nameEn":"Smoked Turkey Club","unitCode":"pc","productId":"<id>"},"location":{"id":"<id>","nameAr":"الرف العلوي","nameEn":"Top shelf"},"warehouse":{"id":"<id>","nameAr":"برّاد 1","nameEn":"Fridge 1","kind":"fridge"},"allergens":"Gluten, Dairy, Egg","productCode":"CLUB"}}

### GET /stock/moves
{"rows":[{"id":"<id>","itemId":"<id>","batchId":"<id>","type":"purchase","qty":100,"locationId":"<id>","unitCostUsd":0.19,"refType":"purchase","refId":"<id>","reasonId":null,"note":null,"userId":"<id>","businessDate":"2026-10-21","nameAr":"خبز","nameEn":"Bread roll","unitCode":"pc","batchCode":"S-1021-21"},"…76 items"]}

### GET /purchases
{"rows":[{"id":"<id>","number":1,"supplierId":"<id>","date":"2026-10-21","currency":"USD","fxRate":null,"total":19,"totalUsd":19,"paid":14,"paidFromBoxId":"<id>","supplierRef":"INV-778","discount":2,"transport":1,"dueDate":"2026-10-28","photo":"","note":"","userId":"<id>","supplierName":"Cold cuts supplier","due":5,"late":false}]}

### GET /purchases/suppliers
{"rows":[{"id":"<id>","name":"Al-Hal market (vegetables)","phone":"","note":"","openingBalance":0,"openingCurrency":"SYP","openingUsd":0,"openingPaidUsd":0,"paymentTermsDays":0,"active":true,"dueUsd":0,"overdueUsd":0,"openInvoices":0},"…2 items"]}

### GET /costing/products
{"rows":[{"id":"<id>","nameAr":"حبش وشيدر","nameEn":"Turkey & Cheddar","category":{"nameAr":"ساندويشات","nameEn":"Sandwiches"},"price":2.5,"currency":"USD","priceUsd":2.5,"costUsd":1.2879,"packagingUsd":0.05,"profitUsd":1.2121,"marginPct":48.484,"hasRecipe":true,"lines":[{"itemId":"<id>","nameAr":"خبز","nameEn":"Bread roll","kind":"ingredient","unitCode":"pc","cleanQty":1,"wastePct":0,"qty":1,"unitCostUsd":0.2059,"costUsd":0.2059},"…8 items"],"extraUsd":0.05,"weightG":220,"cost50Usd":64.395,"cost100Usd":128.79,"targetMarginPct":40,"targetPriceUsd":2.1465,"costInCurrency":1.2879,"targetPrice":2.1465,"belowTarget":false},"…8 items"],"targetMarginPct":40,"rate":null}

### GET /costing/overheads?month=2026-10
{"month":"2026-10","itemsSold":39,"expensesUsd":234,"depreciationUsd":0,"salariesUsd":0,"fixedUsd":234,"perItemUsd":6,"grossProfitPerItemUsd":0.597,"breakEvenItems":392,"itemsLeftToBreakEven":353,"reached":false}

### GET /costing/prep
{"date":"2026-10-22","products":[],"ingredients":[]}

### GET /clients
{"rows":[{"id":"<id>","type":"business","name":"Al-Noor Market","contactPerson":"Abu Fadi","phone":"+963 944 000 444","address":"","tierId":null,"tagId":"<id>","receiptLanguage":"ar","creditLimitUsd":120,"creditBlock":false,"note":"","active":true,"convertedAt":null,"areaId":"<id>","paymentTermsDays":7,"priceListId":"<id>","consignment":true,"repId":"<id>","balanceUsd":-55,"loyalty":{"count":25,"progress":25,"buyQty":100,"available":0,"enabled":true},"subscription":null,"lastOrderDate":"2026-10-21","aging":{"balanceUsd":-55,"oldestUnpaidDate":"2026-10-21","daysOutstanding":0,"termsDays":7,"overdueDays":0}},"…6 items"]}

### GET /clients/01a15bc7-eb27-740d-a53f-6dbdd1942232
{"totals":{"salesUsd":0,"paidUsd":0,"returnsUsd":0},"area":{"id":"<id>","listType":"area","nameAr":"وسط المدينة","nameEn":"Downtown","sort":10,"active":true},"priceList":{"id":"<id>","nameAr":"سعر الموزّع","nameEn":"Distributor price","active":true},"rep":{"id":"<id>","name":"Ahmad (sales & delivery)"},"returns":[],"consignments":[],"client":{"id":"<id>","type":"business","name":"City Distributor","contactPerson":"Omar","phone":"+963 944 000 555","address":"","tierId":null,"tagId":"<id>","receiptLanguage":"ar","creditLimitUsd":400,"creditBlock":false,"note":"","active":true,"convertedAt":null,"areaId":"<id>","paymentTermsDays":14,"priceListId":"<id>","consignment":false,"repId":"<id>","balanceUsd":0,"loyalty":{"count":0,"progress":0,"buyQty":100,"available":0,"enabled":true},"subscription":null,"lastOrderDate":null,"aging":{"balanceUsd":0,"oldestUnpaidDate":null,"daysOutstanding":0,"termsDays":14,"overdueDays":0}},"loyalty":{"enabled":true,"buyQty":100,"freeQty":5,"count":0,"progress":0,"earned":0,"redeemed":0,"available":0},"analytics":{"byCategory":[],"topProducts":[],"monthly":[],"ordersCount":0,"avgOrderUsd":0,"lastOrderDate":null,"trials":0,"converted":false},"moves":[{"id":"<id>","clientId":"<id>","type":"refund","amount":13,"currency":"USD","fxRate":null,"amountUsd":13,"orderId":"<id>","paymentId":null,"note":"Cancel #1","userId":"<id>","businessDate":"2026-10-21","userName":"Owner"},"…2 items"],"subscriptions":[],"prices":[],"recurring":[]}

### GET /clients/01a15bc7-eb27-740d-a53f-6dbdd1942232/statement?from=2026-10-21&to=2026-10-21
{"client":{"id":"<id>","type":"business","name":"City Distributor","contactPerson":"Omar","phone":"+963 944 000 555","address":"","tierId":null,"tagId":"<id>","receiptLanguage":"ar","creditLimitUsd":400,"creditBlock":false,"note":"","active":true,"convertedAt":null,"areaId":"<id>","paymentTermsDays":14,"priceListId":"<id>","consignment":false,"repId":"<id>"},"from":"2026-10-21","to":"2026-10-21","openingUsd":0,"closingUsd":0,"lines":[{"id":"<id>","clientId":"<id>","type":"charge","amount":-13,"currency":"USD","fxRate":null,"amountUsd":-13,"orderId":"<id>","paymentId":null,"note":"#1","userId":"<id>","businessDate":"2026-10-21","balanceUsd":-13},"…2 items"],"orders":[],"returns":[],"aging":{"balanceUsd":0,"oldestUnpaidDate":null,"daysOutstanding":0,"termsDays":14,"overdueDays":0}}

### GET /clients/tiers
{"rows":[{"id":"<id>","nameAr":"عادي","nameEn":"Normal","discountPct":0,"sort":0},"…2 items"]}

### GET /clients/plans
{"rows":[{"id":"<id>","nameAr":"اشتراك شهري 20","nameEn":"Monthly 20","monthlyFee":45,"currency":"USD","discountPct":0,"includedItems":20,"active":true}]}

### GET /clients/calls
{"rows":[]}

### GET /orders?date=2026-10-21
{"rows":[{"id":"<id>","number":5,"businessDate":"2026-10-21","clientId":null,"type":"internal","employeeId":null,"fulfilment":"pickup","assignedTo":null,"status":"confirmed","paymentStatus":"free","methodId":null,"currency":"USD","fxRate":null,"subtotal":5.5,"discount":5.5,"discountReason":"internal:100%","taxTotal":0,"taxesJson":"[]","deliveryFee":0,"total":0,"totalUsd":0,"costUsd":2.078,"itemsCount":2,"freeItems":0,"loyaltyFree":0,"subFree":0,"note":"tasting new sauce","userId":"<id>","cancelledAt":null,"cancelReason":"","paidAmount":0,"consignmentId":null,"clientName":null,"method":null,"userName":"Owner","assignedName":null},"…5 items"]}

### GET /orders/01a15bc7-ec47-7268-a6cb-c419ece75e3a
{"order":{"id":"<id>","number":5,"businessDate":"2026-10-21","clientId":null,"type":"internal","employeeId":null,"fulfilment":"pickup","assignedTo":null,"status":"confirmed","paymentStatus":"free","methodId":null,"currency":"USD","fxRate":null,"subtotal":5.5,"discount":5.5,"discountReason":"internal:100%","taxTotal":0,"taxesJson":"[]","deliveryFee":0,"total":0,"totalUsd":0,"costUsd":2.078,"itemsCount":2,"freeItems":0,"loyaltyFree":0,"subFree":0,"note":"tasting new sauce","userId":"<id>","cancelledAt":null,"cancelReason":"","paidAmount":0,"consignmentId":null,"clientName":null,"method":null,"userName":"Owner","assignedName":null,"lines":[{"id":"<id>","orderId":"<id>","productId":"<id>","nameAr":"دجاج بيستو","nameEn":"Chicken Pesto","qty":2,"freeQty":0,"unitPrice":2.75,"optionsJson":"[]","lineTotal":5.5,"unitCostUsd":1.039,"options":[]}],"payments":[],"taxes":[]}}

### GET /orders/01a15bc7-ec47-7268-a6cb-c419ece75e3a/receipt
{"receipt":{"payment":{"paid":0,"remaining":0},"account":null,"business":{"nameAr":"جي جيز","nameEn":"JJ's Kitchen","phone":"","address":"","logo":""},"printing":{"receiptWidthMm":80,"labelWidthMm":50,"labelHeightMm":30,"receiptFooterAr":"شكراً لكم","receiptFooterEn":"Thank you","invoiceSize":"thermal"},"order":{"id":"<id>","number":5,"businessDate":"2026-10-21","clientId":null,"type":"internal","employeeId":null,"fulfilment":"pickup","assignedTo":null,"status":"confirmed","paymentStatus":"free","methodId":null,"currency":"USD","fxRate":null,"subtotal":5.5,"discount":5.5,"discountReason":"internal:100%","taxTotal":0,"taxesJson":"[]","deliveryFee":0,"total":0,"totalUsd":0,"costUsd":2.078,"itemsCount":2,"freeItems":0,"loyaltyFree":0,"subFree":0,"note":"tasting new sauce","userId":"<id>","cancelledAt":null,"cancelReason":"","paidAmount":0,"consignmentId":null,"clientName":null,"method":null,"userName":"Owner","assignedName":null,"taxes":[]},"lines":[{"id":"<id>","orderId":"<id>","productId":"<id>","nameAr":"دجاج بيستو","nameEn":"Chicken Pesto","qty":2,"freeQty":0,"unitPrice":2.75,"optionsJson":"[]","lineTotal":5.5,"unitCostUsd":1.039,"options":[]}],"client":null,"loyalty":null}}

### GET /orders/recurring/due
{"rows":[]}

### GET /money/boxes
{"rows":[{"id":"<id>","nameAr":"الصندوق الرئيسي (كاش)","nameEn":"Main cash box","kind":"cash","currency":"USD","employeeId":null,"systemKey":"main_cash","active":true,"balance":394.25},"…3 items"]}

### GET /money/methods
{"rows":[{"id":"<id>","nameAr":"كاش","nameEn":"Cash","kind":"box","boxId":"<id>","systemKey":"cash","sort":0,"active":true},"…4 items"]}

### GET /money/boxes/01a15bc7-e831-7463-8535-fa3204a93b9c/moves
{"box":{"id":"<id>","nameAr":"الصندوق الرئيسي (كاش)","nameEn":"Main cash box","kind":"cash","currency":"USD","employeeId":null,"systemKey":"main_cash","active":true,"balance":394.25},"rows":[{"id":"<id>","boxId":"<id>","type":"withdrawal","amount":-20,"currency":"USD","fxRate":null,"amountUsd":-20,"refType":"withdrawal","refId":null,"note":"Owner","userId":"<id>","businessDate":"2026-10-21","userName":"Owner"},"…10 items"]}

### GET /money/reps
{"rows":[{"id":"<id>","name":"Ahmad (sales & delivery)","boxId":"<id>"}]}

### GET /days
{"rows":[{"id":"<id>","date":"2026-10-21","status":"open","closedAt":null,"closedBy":null,"expectedCashUsd":null,"countedCashUsd":null,"differenceUsd":null,"totalsJson":null,"reopenedAt":null,"reopenedBy":null,"totals":null}]}

### GET /days/2026-10-21
{"cashFlow":{"currency":"USD","opening":0,"moves":[{"type":"expense","amount":-34,"n":2},"…6 items"],"expected":394.25},"repSettlement":[{"employeeId":"<id>","name":"Ahmad (sales & delivery)","boxId":"<id>","cash":0,"currency":"USD","deliveries":1,"items":25,"returns":1,"returnsUsd":11,"expensesUsd":4,"openConsignments":0}],"production":[{"productId":"<id>","nameAr":"حبش وشيدر","nameEn":"Turkey & Cheddar","opening":0,"made":50,"fromFridge":0,"consigned":30,"returnedIn":5,"wasted":5,"counted":0,"other":0,"closing":20,"soldTotal":0,"madeFresh":0,"consignSold":25,"leftNow":20,"difference":0},"…3 items"],"day":{"id":"<id>","date":"2026-10-21","status":"open","closedAt":null,"closedBy":null,"expectedCashUsd":null,"countedCashUsd":null,"differenceUsd":null,"totalsJson":null,"reopenedAt":null,"reopenedBy":null,"totals":null,"closedByName":null},"report":{"from":"2026-10-21","to":"2026-10-21","orders":4,"items":39,"freeItems":0,"salesUsd":86.5,"returnsUsd":7.65,"returnsCount":2,"returnedQty":{"restock":2,"waste":6},"netSalesUsd":78.85,"collectedUsd":4.5,"purchasesUsd":19,"purchasesCount":1,"internalUse":{"orders":1,"items":2,"costUsd":2.218},"withdrawalsUsd":20,"dueExpensesUsd":0,"avgRate":null,"grossUsd":95,"discountUsd":8.5,"taxUsd":0,"deliveryUsd":0,"costUsd":48.264,"grossProfitUsd":30.586,"marginPct":38.7901,"operatingProfitUsd":-10.716,"expensesUsd":34,"wasteUsd":7.302,"depreciationUsd":0,"salariesUsd":0,"netUsd":-10.716,"byStatus":[{"status":"credit","n":2,"usd":82},"…3 items"],"byMethod":[{"methodId":null,"nameAr":null,"nameEn":null,"n":1,"usd":0},"…3 items"],"byType":[{"type":"internal","n":1,"items":2},"…2 items"],"byProduct":[{"productId":"<id>","nameAr":"حبش وشيدر","nameEn":"Turkey & Cheddar","qty":25,"revenueUsd":55,"costUsd":31.975,"marginPct":41.8636},"…4 items"],"byCategory":[{"categoryId":"<id>","nameAr":"ساندويشات","nameEn":"Sandwiches","qty":39,"revenueUsd":95,"costUsd":52.497,"marginPct":44.74}],"byClient":[{"clientId":"<id>","name":"Al-Noor Market","orders":1,"items":25,"salesUsd":55,"costUsd":31.975,"returnsUsd":0,"profitUsd":23.025,"marginPct":41.8636,"balanceUsd":-55,"overdueDays":0},"…3 items"],"expenses":[{"categoryId":"<id>","nameAr":"وقود","nameEn":"Fuel","usd":4,"n":1},"…2 items"],"waste":[{"itemId":"<id>","nameAr":"حبش وشيدر","nameEn":"Turkey & Cheddar","qty":5,"usd":6.395},"…2 items"],"depreciation":[],"trials":{"given":0,"converted":0,"rate":0}},"mainBox":{"id":"<id>","nameAr":"الصندوق الرئيسي (كاش)","nameEn":"Main cash box","currency":"USD","expected":394.25},"reps":[]}

### GET /expenses
{"rows":[{"id":"<id>","date":"2026-10-21","categoryId":"<id>","itemId":null,"amount":4,"currency":"USD","fxRate":null,"amountUsd":4,"boxId":"<id>","assetId":null,"note":"","userId":"<id>","status":"paid","dueDate":null,"paidDate":"2026-10-21","paidBy":"Ahmad","beneficiary":"","photo":"","employeeId":"<id>","recurringId":null,"category":{"nameAr":"وقود","nameEn":"Fuel"},"item":null,"box":{"nameAr":"الصندوق الرئيسي (كاش)","nameEn":"Main cash box"},"userName":"Owner","employeeName":"Ahmad (sales & delivery)"},"…3 items"]}

### GET /assets
{"rows":[]}

### GET /people/employees
{"rows":[{"id":"<id>","name":"Ahmad (sales & delivery)","phone":"","jobTitle":"Sales & delivery","userId":null,"payModel":"both","baseSalary":150,"currency":"USD","commissionPerClientUsd":5,"commissionPct":3,"staffDiscountPct":30,"isDeliveryRep":true,"active":true,"userName":null}]}

### GET /people/advances
{"rows":[]}

### GET /people/payroll/2026-10
{"month":"2026-10","status":"preview","rows":[{"employeeId":"<id>","name":"Ahmad (sales & delivery)","payModel":"both","currency":"USD","baseUsd":150,"deliveredSalesUsd":55,"deliveredOrders":1,"convertedClients":0,"commissionUsd":1.65,"staffPurchasesUsd":0,"openAdvancesUsd":0,"advancesUsd":0,"netUsd":151.65}]}

### GET /reports/dashboard
{"date":"2026-10-21","today":{"from":"2026-10-21","to":"2026-10-21","orders":4,"items":39,"freeItems":0,"salesUsd":86.5,"returnsUsd":7.65,"returnsCount":2,"returnedQty":{"restock":2,"waste":6},"netSalesUsd":78.85,"collectedUsd":4.5,"purchasesUsd":19,"purchasesCount":1,"internalUse":{"orders":1,"items":2,"costUsd":2.218},"withdrawalsUsd":20,"dueExpensesUsd":0,"avgRate":null,"grossUsd":95,"discountUsd":8.5,"taxUsd":0,"deliveryUsd":0,"costUsd":48.264,"grossProfitUsd":30.586,"marginPct":38.7901,"operatingProfitUsd":-10.716,"expensesUsd":34,"wasteUsd":7.302,"depreciationUsd":0,"salariesUsd":0,"netUsd":-10.716,"byStatus":[{"status":"credit","n":2,"usd":82},"…3 items"],"byMethod":[{"methodId":null,"nameAr":null,"nameEn":null,"n":1,"usd":0},"…3 items"],"byType":[{"type":"internal","n":1,"items":2},"…2 items"],"byProduct":[{"productId":"<id>","nameAr":"حبش وشيدر","nameEn":"Turkey & Cheddar","qty":25,"revenueUsd":55,"costUsd":31.975,"marginPct":41.8636},"…4 items"],"byCategory":[{"categoryId":"<id>","nameAr":"ساندويشات","nameEn":"Sandwiches","qty":39,"revenueUsd":95,"costUsd":52.497,"marginPct":44.74}],"byClient":[{"clientId":"<id>","name":"Al-Noor Market","orders":1,"items":25,"salesUsd":55,"costUsd":31.975,"returnsUsd":0,"profitUsd":23.025,"marginPct":41.8636,"balanceUsd":-55,"overdueDays":0},"…3 items"],"expenses":[{"categoryId":"<id>","nameAr":"وقود","nameEn":"Fuel","usd":4,"n":1},"…2 items"],"waste":[{"itemId":"<id>","nameAr":"حبش وشيدر","nameEn":"Turkey & Cheddar","qty":5,"usd":6.395},"…2 items"],"depreciation":[],"trials":{"given":0,"converted":0,"rate":0}},"week":[{"date":"2026-10-15","salesUsd":0,"orders":0},"…7 items"],"recent":[{"id":"<id>","number":5,"businessDate":"2026-10-21","clientId":null,"type":"internal","employeeId":null,"fulfilment":"pickup","assignedTo":null,"status":"confirmed","paymentStatus":"free","methodId":null,"currency":"USD","fxRate":null,"subtotal":5.5,"discount":5.5,"discountReason":"internal:100%","taxTotal":0,"taxesJson":"[]","deliveryFee":0,"total":0,"totalUsd":0,"costUsd":2.078,"itemsCount":2,"freeItems":0,"loyaltyFree":0,"subFree":0,"note":"tasting new sauce","userId":"<id>","cancelledAt":null,"cancelReason":"","paidAmount":0,"consignmentId":null,"clientName":null},"…5 items"],"alerts":{"overdueClients":[],"dueExpenses":[{"id":"<id>","date":"2026-10-01","amount":200,"currency":"USD","note":"Kitchen rent"}],"suppliersOverdueUsd":0,"expired":[],"expiresToday":[{"id":"<id>","itemId":"<id>","locationId":"<id>","batchCode":"R-1021-02","producedAt":"2026-10-21T00:06:31.196Z","expiresAt":"2026-10-21T20:59:00.000Z","qtyIn":2,"qtyLeft":2,"unitCostUsd":1.663,"runId":null,"nameAr":"كلوب حبش مدخّن","nameEn":"Smoked Turkey Club","unitCode":"pc"}],"lowStock":[{"id":"<id>","nameAr":"حبش مدخّن","nameEn":"Smoked turkey","unitCode":"kg","qty":0.3,"minLevel":1},"…3 items"],"nearCreditLimit":[],"repCash":[]},"boxes":[{"id":"<id>","nameAr":"الصندوق الرئيسي (كاش)","nameEn":"Main cash box","kind":"cash","currency":"USD","balance":394.25,"todayIn":394.25},"…3 items"],"unpaid":[{"id":"<id>","name":"Al-Noor Market","balanceUsd":-55,"creditLimitUsd":120},"…2 items"],"five":{"date":"2026-10-21","rate":null,"sold":{"items":39,"orders":4,"salesUsd":78.85},"cost":{"goodsUsd":48.264,"wasteUsd":7.302},"profit":{"grossUsd":30.586,"afterExpensesUsd":-10.716,"expensesUsd":34},"money":{"cashUsd":394.25,"collectedTodayUsd":4.5,"clientsOweUsd":76.6,"weOweUsd":5,"goodsAtShopsUsd":0},"prices":{"ok":true,"targetMarginPct":40,"below":[]}},"stockValueUsd":362.9964}

### GET /reports/range?from=2026-10-21&to=2026-10-21
{"from":"2026-10-21","to":"2026-10-21","orders":4,"items":39,"freeItems":0,"salesUsd":86.5,"returnsUsd":7.65,"returnsCount":2,"returnedQty":{"restock":2,"waste":6},"netSalesUsd":78.85,"collectedUsd":4.5,"purchasesUsd":19,"purchasesCount":1,"internalUse":{"orders":1,"items":2,"costUsd":2.218},"withdrawalsUsd":20,"dueExpensesUsd":0,"avgRate":null,"grossUsd":95,"discountUsd":8.5,"taxUsd":0,"deliveryUsd":0,"costUsd":48.264,"grossProfitUsd":30.586,"marginPct":38.7901,"operatingProfitUsd":-10.716,"expensesUsd":34,"wasteUsd":7.302,"depreciationUsd":0,"salariesUsd":0,"netUsd":-10.716,"byStatus":[{"status":"credit","n":2,"usd":82},"…3 items"],"byMethod":[{"methodId":null,"nameAr":null,"nameEn":null,"n":1,"usd":0},"…3 items"],"byType":[{"type":"internal","n":1,"items":2},"…2 items"],"byProduct":[{"productId":"<id>","nameAr":"حبش وشيدر","nameEn":"Turkey & Cheddar","qty":25,"revenueUsd":55,"costUsd":31.975,"marginPct":41.8636},"…4 items"],"byCategory":[{"categoryId":"<id>","nameAr":"ساندويشات","nameEn":"Sandwiches","qty":39,"revenueUsd":95,"costUsd":52.497,"marginPct":44.74}],"byClient":[{"clientId":"<id>","name":"Al-Noor Market","orders":1,"items":25,"salesUsd":55,"costUsd":31.975,"returnsUsd":0,"profitUsd":23.025,"marginPct":41.8636,"balanceUsd":-55,"overdueDays":0},"…3 items"],"expenses":[{"categoryId":"<id>","nameAr":"وقود","nameEn":"Fuel","usd":4,"n":1},"…2 items"],"waste":[{"itemId":"<id>","nameAr":"حبش وشيدر","nameEn":"Turkey & Cheddar","qty":5,"usd":6.395},"…2 items"],"depreciation":[],"trials":{"given":0,"converted":0,"rate":0},"unpaid":[{"id":"<id>","name":"Al-Noor Market","balanceUsd":-55,"creditLimitUsd":120},"…2 items"]}

### GET /system/network
{"lanAccess":false,"addresses":["http://192.0.2.2:4395"],"port":4395,"dataDir":"/tmp/jjs-w","listeningOnLan":false}

### GET /system/sync
{"enabled":false,"supabaseUrl":"","hasKey":false,"status":{"lastRunAt":null,"lastOkAt":null,"lastError":null,"pushed":0},"pending":504}

### GET /fx/current
{"rate":null,"source":null,"manualRate":null,"apiConfigured":false,"lastError":null}

### GET /taxes
{"taxes":[]}

### GET /lookups?type=expense_category
{"items":[{"id":"<id>","listType":"expense_category","nameAr":"مواد غذائية","nameEn":"Food supplies","sort":0,"active":true},"…16 items"],"canAdd":true}

### GET /consignments
{"rows":[{"id":"<id>","number":1,"businessDate":"2026-10-21","clientId":"<id>","repId":"<id>","status":"settled","currency":"USD","fxRate":null,"note":"","userId":"<id>","settledAt":"2026-10-21T00:06:31.160Z","orderId":"<id>","returnId":"<id>","clientName":"Al-Noor Market","repName":"Ahmad (sales & delivery)","lines":[{"id":"<id>","consignmentId":"<id>","productId":"<id>","nameAr":"حبش وشيدر","nameEn":"Turkey & Cheddar","qty":30,"unitPrice":2.2,"unitCostUsd":1.279,"returnedQty":5}],"value":66,"qty":30,"orderNumber":2}]}

### GET /consignments/01a15bc7-ebe6-7468-bbbe-b61113771e4d
{"consignment":{"id":"<id>","number":1,"businessDate":"2026-10-21","clientId":"<id>","repId":"<id>","status":"settled","currency":"USD","fxRate":null,"note":"","userId":"<id>","settledAt":"2026-10-21T00:06:31.160Z","orderId":"<id>","returnId":"<id>","clientName":"Al-Noor Market","repName":"Ahmad (sales & delivery)","lines":[{"id":"<id>","consignmentId":"<id>","productId":"<id>","nameAr":"حبش وشيدر","nameEn":"Turkey & Cheddar","qty":30,"unitPrice":2.2,"unitCostUsd":1.279,"returnedQty":5}],"value":66,"qty":30,"orderNumber":2}}

### GET /returns
{"rows":[{"id":"<id>","number":3,"businessDate":"2026-10-21","clientId":null,"orderId":"<id>","consignmentId":null,"currency":"USD","fxRate":null,"total":2.25,"totalUsd":2.25,"costUsd":0.907,"settlement":"refund","boxId":"<id>","repId":null,"note":"","userId":"<id>","clientName":null,"userName":"Owner","orderNumber":4,"lines":[{"id":"<id>","returnId":"<id>","productId":"<id>","nameAr":"حلوم وبندورة","nameEn":"Halloumi & Tomato","qty":1,"unitPrice":2.25,"lineTotal":2.25,"unitCostUsd":0.907,"action":"waste","batchId":"<id>"}]},"…3 items"]}

### GET /returns/01a15bc7-ec3f-73fa-b02d-fc8ae9ebc338
{"return":{"id":"<id>","number":3,"businessDate":"2026-10-21","clientId":null,"orderId":"<id>","consignmentId":null,"currency":"USD","fxRate":null,"total":2.25,"totalUsd":2.25,"costUsd":0.907,"settlement":"refund","boxId":"<id>","repId":null,"note":"","userId":"<id>","clientName":null,"userName":"Owner","orderNumber":4,"lines":[{"id":"<id>","returnId":"<id>","productId":"<id>","nameAr":"حلوم وبندورة","nameEn":"Halloumi & Tomato","qty":1,"unitPrice":2.25,"lineTotal":2.25,"unitCostUsd":0.907,"action":"waste","batchId":"<id>"}]}}

### GET /production?from=2026-10-21&to=2026-10-21
{"rows":[{"id":"<id>","number":1,"businessDate":"2026-10-21","employeeId":"<id>","itemsCount":80,"costUsd":113.84,"note":"","userId":"<id>","employeeName":"Ahmad (sales & delivery)","userName":"Owner","batches":[{"id":"<id>","itemId":"<id>","locationId":"<id>","batchCode":"B-1021-01","producedAt":"2026-10-21T00:06:31.102Z","expiresAt":"2026-10-22T00:06:31.102Z","qtyIn":50,"qtyLeft":20,"unitCostUsd":1.279,"runId":"<id>","nameAr":"حبش وشيدر","nameEn":"Turkey & Cheddar","productId":"<id>"},"…2 items"]}]}

### GET /production/01a15bc7-ebb8-7388-bcaf-7724b46a536c
{"run":{"id":"<id>","number":1,"businessDate":"2026-10-21","employeeId":"<id>","itemsCount":80,"costUsd":113.84,"note":"","userId":"<id>","employeeName":"Ahmad (sales & delivery)","userName":"Owner","batches":[{"id":"<id>","itemId":"<id>","locationId":"<id>","batchCode":"B-1021-01","producedAt":"2026-10-21T00:06:31.102Z","expiresAt":"2026-10-22T00:06:31.102Z","qtyIn":50,"qtyLeft":20,"unitCostUsd":1.279,"runId":"<id>","nameAr":"حبش وشيدر","nameEn":"Turkey & Cheddar","productId":"<id>"},"…2 items"]}}

### GET /trace/B-1021-01
{"batch":{"id":"<id>","itemId":"<id>","locationId":"<id>","batchCode":"B-1021-01","producedAt":"2026-10-21T00:06:31.102Z","expiresAt":"2026-10-22T00:06:31.102Z","qtyIn":50,"qtyLeft":20,"unitCostUsd":1.279,"runId":"<id>","nameAr":"حبش وشيدر","nameEn":"Turkey & Cheddar"},"run":{"number":1,"employeeName":"Ahmad (sales & delivery)","date":"2026-10-21"},"received":[{"kind":"consignment","id":"<id>","number":1,"date":"2026-10-21","clientId":"<id>","clientName":"Al-Noor Market","phone":"+963 944 000 444","qty":30,"status":"settled"}],"clientsCount":1}

### GET /route-sheet
{"date":"2026-10-21","rep":null,"stops":[{"clientId":"<id>","name":"Al-Noor Market","phone":"+963 944 000 444","address":"","areaId":"<id>","standing":[],"orders":[{"id":"<id>","number":2,"total":55,"currency":"USD","paymentStatus":"credit","status":"confirmed","items":25}],"consignments":[],"balanceUsd":-55,"overdueDays":0}]}

### GET /clients/01a15bc7-eb27-740d-a53f-6dbdd1942232/snapshot
{"client":{"id":"<id>","name":"City Distributor","phone":"+963 944 000 555","creditLimitUsd":400,"creditBlock":false,"consignment":false,"paymentTermsDays":14},"lastOrder":null,"aging":{"balanceUsd":0,"oldestUnpaidDate":null,"daysOutstanding":0,"termsDays":14,"overdueDays":0},"month":{"orders":0,"salesUsd":0,"items":0},"tier":null,"agreedPrices":[{"productId":"<id>","nameAr":"حبش وشيدر","nameEn":"Turkey & Cheddar","price":1.9,"currency":"USD","from":"list"},"…5 items"],"openConsignments":0}

### GET /clients/price-lists
{"rows":[{"id":"<id>","nameAr":"سعر الموزّع","nameEn":"Distributor price","active":true,"clients":1,"items":5},"…2 items"]}

### GET /clients/price-lists/01a15bc7-eb24-715d-9a8b-0127779e2212/items
{"rows":[{"id":"<id>","listId":"<id>","productId":"<id>","price":1.9,"currency":"USD","nameAr":"حبش وشيدر","nameEn":"Turkey & Cheddar","menuPrice":2.5,"menuCurrency":"USD"},"…5 items"]}

### GET /purchases/suppliers/01a15bc7-eb27-740d-a53f-863b99b29a05/statement
{"supplier":{"id":"<id>","name":"Cold cuts supplier","phone":"","note":"","openingBalance":40,"openingCurrency":"USD","openingUsd":40,"openingPaidUsd":40,"paymentTermsDays":7,"active":true},"from":"2000-01-01","to":"2026-10-21","openingUsd":40,"closingUsd":5,"lines":[{"date":"2026-10-21","at":"2026-10-21T00:06:31.265Z","kind":"purchase","ref":"#1 (INV-778)","owedUsd":19,"paidUsd":0,"amount":19,"currency":"USD","balanceUsd":59},"…3 items"],"due":{"openingDueUsd":0,"purchasesDueUsd":5,"totalDueUsd":5,"overdueUsd":0,"open":[{"id":"<id>","number":1,"date":"2026-10-21","supplierRef":"INV-778","currency":"USD","total":19,"paid":14,"due":5,"dueUsd":5,"dueDate":"2026-10-28","late":false}]}}

### GET /purchases/debts
{"rows":[{"id":"<id>","name":"Cold cuts supplier","phone":"","openingDueUsd":0,"purchasesDueUsd":5,"totalDueUsd":5,"overdueUsd":0,"open":[{"id":"<id>","number":1,"date":"2026-10-21","supplierRef":"INV-778","currency":"USD","total":19,"paid":14,"due":5,"dueUsd":5,"dueDate":"2026-10-28","late":false}]}],"totalUsd":5,"overdueUsd":0}

### GET /purchases/price-changes
{"rows":[{"id":"<id>","itemId":"<id>","oldCostUsd":0.25,"newCostUsd":0.19,"changePct":-24,"purchaseId":"<id>","businessDate":"2026-10-21","nameAr":"خبز","nameEn":"Bread roll","unitCode":"pc"}]}

### GET /expenses/recurring
{"rows":[{"id":"<id>","categoryId":"<id>","itemId":null,"amount":200,"currency":"USD","dayOfMonth":1,"beneficiary":"Landlord","note":"Kitchen rent","active":true,"lastMonth":"2026-10"}]}

### GET /expenses?status=due
{"rows":[{"id":"<id>","date":"2026-10-01","categoryId":"<id>","itemId":null,"amount":200,"currency":"USD","fxRate":null,"amountUsd":200,"boxId":null,"assetId":null,"note":"Kitchen rent","userId":null,"status":"due","dueDate":"2026-10-01","paidDate":null,"paidBy":"","beneficiary":"Landlord","photo":"","employeeId":null,"recurringId":"<id>","category":{"nameAr":"إيجار","nameEn":"Rent"},"item":null,"box":null,"userName":null,"employeeName":null}]}

### GET /money/withdrawals?from=2026-10-21&to=2026-10-21
{"rows":[{"id":"<id>","boxId":"<id>","type":"withdrawal","amount":-20,"currency":"USD","fxRate":null,"amountUsd":-20,"refType":"withdrawal","refId":null,"note":"Owner","userId":"<id>","businessDate":"2026-10-21","box":{"nameAr":"الصندوق الرئيسي (كاش)","nameEn":"Main cash box"}}],"totalUsd":20}

### GET /costing/impact
{"since":"2026-09-21","targetMarginPct":40,"changes":[{"id":"<id>","itemId":"<id>","oldCostUsd":0.25,"newCostUsd":0.19,"changePct":-24,"purchaseId":"<id>","businessDate":"2026-10-21","nameAr":"خبز","nameEn":"Bread roll","unitCode":"pc"}],"products":[{"productId":"<id>","nameAr":"حبش وشيدر","nameEn":"Turkey & Cheddar","price":2.5,"currency":"USD","costBeforeUsd":1.332,"costNowUsd":1.2879,"profitChangeUsd":0.0441,"marginBefore":46.72,"marginNow":48.484,"belowTarget":false,"suggestedPrice":2.1465,"items":["01a15bc7-eaf7-75e4-b7f0-087d197e63d6"]},"…5 items"]}

### GET /costing/forecast
{"date":"2026-10-22","basedOn":["2026-10-15","…4 items"],"products":[],"materials":[]}

### GET /reports/five
{"date":"2026-10-21","rate":null,"sold":{"items":39,"orders":4,"salesUsd":78.85},"cost":{"goodsUsd":48.264,"wasteUsd":7.302},"profit":{"grossUsd":30.586,"afterExpensesUsd":-10.716,"expensesUsd":34},"money":{"cashUsd":394.25,"collectedTodayUsd":4.5,"clientsOweUsd":76.6,"weOweUsd":5,"goodsAtShopsUsd":0},"prices":{"ok":true,"targetMarginPct":40,"below":[]}}

### GET /reports/production?from=2026-10-21&to=2026-10-21
{"from":"2026-10-21","to":"2026-10-21","rows":[{"itemId":"<id>","productId":"<id>","nameAr":"حبش وشيدر","nameEn":"Turkey & Cheddar","opening":0,"made":50,"fromFridge":0,"consigned":30,"returnedIn":5,"wasted":5,"counted":0,"other":0,"closing":20,"soldTotal":0,"madeFresh":0,"consignSold":25,"leftNow":20,"difference":0},"…3 items"]}

### GET /reports/cashflow?from=2026-10-21&to=2026-10-21
{"from":"2026-10-21","to":"2026-10-21","boxes":[{"id":"<id>","nameAr":"الصندوق الرئيسي (كاش)","nameEn":"Main cash box","currency":"USD","opening":0,"moves":[{"type":"expense","amount":-34,"usd":-34,"n":2},"…6 items"],"closing":394.25},"…3 items"],"byType":[{"type":"expense","usd":-34},"…6 items"],"inUsd":504.5,"outUsd":110.25,"netUsd":394.25}

### GET /reports/months?n=3
{"rows":[{"month":"2026-08","orders":0,"items":0,"salesUsd":0,"costUsd":0,"grossProfitUsd":0,"expensesUsd":0,"wasteUsd":0,"salariesUsd":0,"depreciationUsd":0,"netUsd":0,"marginPct":0,"avgRate":null},"…3 items"]}

### GET /reports/delivery-cost?from=2026-10-21&to=2026-10-21
{"from":"2026-10-21","to":"2026-10-21","rows":[{"employeeId":"<id>","name":"Ahmad (sales & delivery)","category":"Fuel","usd":4,"n":1}],"totalUsd":4,"deliveries":1,"perDeliveryUsd":4,"feesCollectedUsd":0}

### GET /backups/restore
{"pending":false}

### POST /production/preview
{"products":[{"productId":"<id>","nameAr":"سلطة سيزر","nameEn":"Caesar Salad","qty":10,"unitCostUsd":1.055,"costUsd":10.55}],"materials":[{"itemId":"<id>","nameAr":"خس روماني","nameEn":"Romaine","kind":"ingredient","unitCode":"kg","need":1.5,"have":2,"short":0,"costUsd":2.1},"…6 items"],"itemsCount":10,"costUsd":10.55,"shortages":0}

### POST /orders/quote
{"currency":"USD","rate":null,"client":{"id":"<id>","name":"City Distributor","creditLimitUsd":400,"creditBlock":false,"balanceUsd":0},"employee":null,"lines":[{"productId":"<id>","nameAr":"سلطة سيزر","nameEn":"Caesar Salad","qty":2,"freeQty":0,"basePrice":3,"specialPrice":false,"priceFrom":"menu","options":[],"unitPrice":3,"lineTotal":6}],"subtotal":6,"discount":0,"discountPct":0,"discountReason":"","freeItems":0,"subFree":0,"loyaltyFree":0,"taxes":[],"taxTotal":0,"deliveryFee":0,"total":6,"totalUsd":6,"itemsCount":2,"loyalty":{"enabled":true,"buyQty":100,"freeQty":5,"count":0,"progress":0,"earned":0,"redeemed":0,"available":0},"subscription":null}

