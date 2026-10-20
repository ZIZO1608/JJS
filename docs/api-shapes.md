
### GET /system/app-settings
{"defaultCurrency":"USD","loyalty":{"enabled":true,"buyQty":100,"freeQty":5},"orders":{"defaultDeliveryFee":0,"allowStacking":false},"printing":{"receiptWidthMm":80,"labelWidthMm":50,"labelHeightMm":30,"receiptFooterAr":"شكراً لكم","receiptFooterEn":"Thank you"},"business":{"nameAr":"جي جيز","nameEn":"JJ's deli shop","phone":"","address":"","logo":""}}

### GET /menu/catalog
{"categories":[{"id":"<id>","nameAr":"ساندويشات","nameEn":"Sandwiches","sort":0,"active":true},"…3 items"],"products":[{"id":"<id>","categoryId":"<id>","code":"CAESAR","nameAr":"سلطة سيزر","nameEn":"Caesar Salad","price":3,"currency":"USD","shelfLifeHours":12,"allergens":"Dairy, Gluten","photo":"","sort":0,"active":true,"groupIds":[]},"…8 items"],"groups":[{"id":"<id>","nameAr":"إضافات","nameEn":"Extras","minSelect":0,"maxSelect":4,"sort":0,"options":[{"id":"<id>","groupId":"<id>","nameAr":"حشوة مضاعفة","nameEn":"Double filling","priceDelta":1,"currency":"USD","sort":0,"active":true},"…3 items"]},"…3 items"]}

### GET /menu/categories
{"rows":[{"id":"<id>","nameAr":"ساندويشات","nameEn":"Sandwiches","sort":0,"active":true},"…3 items"]}

### GET /menu/option-groups
{"rows":[{"id":"<id>","nameAr":"إضافات","nameEn":"Extras","minSelect":0,"maxSelect":4,"sort":0},"…3 items"]}

### GET /menu/options?groupId=01a15b8f-3425-766f-8079-575b31f47531
{"rows":[{"id":"<id>","groupId":"<id>","nameAr":"حشوة مضاعفة","nameEn":"Double filling","priceDelta":1,"currency":"USD","sort":0,"active":true},"…3 items"]}

### GET /menu/options/01a15b8f-3426-768d-a401-337ae461c3c4/recipe
{"recipe":[{"itemId":"<id>","qty":0.08,"nameAr":"صدر حبش","nameEn":"Turkey breast","kind":"ingredient","unitCode":"kg","avgCostUsd":10}]}

### GET /menu/products
{"rows":[{"id":"<id>","categoryId":"<id>","code":"CAESAR","nameAr":"سلطة سيزر","nameEn":"Caesar Salad","price":3,"currency":"USD","shelfLifeHours":12,"allergens":"Dairy, Gluten","photo":"","sort":0,"active":true,"itemId":"<id>","minLevel":0,"ownGroupIds":[],"groupIds":[],"recipe":[{"itemId":"<id>","qty":0.15,"nameAr":"خس روماني","nameEn":"Romaine","kind":"ingredient","unitCode":"kg","avgCostUsd":1.4},"…6 items"],"costUsd":1.055},"…8 items"]}

### GET /stock/warehouses
{"rows":[{"id":"<id>","nameAr":"برّاد 1","nameEn":"Fridge 1","kind":"fridge","sort":0,"active":true},"…4 items"]}

### GET /stock/locations
{"rows":[{"id":"<id>","warehouseId":"<id>","nameAr":"الرف العلوي","nameEn":"Top shelf","active":true},"…7 items"]}

### GET /stock/items
{"rows":[{"id":"<id>","kind":"ingredient","productId":null,"nameAr":"باتي لحم","nameEn":"Beef patty","unitId":null,"unitCode":"pc","minLevel":20,"avgCostUsd":0.9,"active":true,"qty":59,"valueUsd":53.1,"low":false},"…28 items"]}

### GET /stock/batches
{"rows":[{"id":"<id>","itemId":"<id>","locationId":"<id>","batchCode":"S-1021-01","producedAt":"2026-10-20T23:04:34.064Z","expiresAt":"2026-10-22T23:04:34.063Z","qtyIn":120,"qtyLeft":88,"unitCostUsd":0.25,"status":"soon","item":{"id":"<id>","kind":"ingredient","nameAr":"خبز","nameEn":"Bread roll","unitCode":"pc","productId":null},"location":{"id":"<id>","nameAr":"رف A","nameEn":"Shelf A"},"warehouse":{"id":"<id>","nameAr":"المستودع","nameEn":"Main store","kind":"store"},"allergens":"","productCode":null},"…21 items"]}

### GET /stock/scan/S-1021-01
{"kind":"batch","batch":{"id":"<id>","itemId":"<id>","locationId":"<id>","batchCode":"S-1021-01","producedAt":"2026-10-20T23:04:34.064Z","expiresAt":"2026-10-22T23:04:34.063Z","qtyIn":120,"qtyLeft":88,"unitCostUsd":0.25,"status":"soon","item":{"id":"<id>","kind":"ingredient","nameAr":"خبز","nameEn":"Bread roll","unitCode":"pc","productId":null},"location":{"id":"<id>","nameAr":"رف A","nameEn":"Shelf A"},"warehouse":{"id":"<id>","nameAr":"المستودع","nameEn":"Main store","kind":"store"},"allergens":"","productCode":null}}

### GET /stock/moves
{"rows":[{"id":"<id>","itemId":"<id>","batchId":"<id>","type":"use","qty":-0.06,"locationId":"<id>","unitCostUsd":1.2,"refType":"order","refId":"<id>","reasonId":null,"note":null,"userId":"<id>","businessDate":"2026-10-21","nameAr":"ليمون ونعناع","nameEn":"Lemon & mint","unitCode":"kg","batchCode":"S-1021-15"},"…106 items"]}

### GET /purchases
{"rows":[{"id":"<id>","number":1,"supplierId":"<id>","date":"2026-10-21","currency":"USD","fxRate":115,"total":55.44,"totalUsd":55.44,"paid":55.44,"paidFromBoxId":"<id>","note":"","userId":"<id>","supplierName":"Cold cuts supplier","due":0}]}

### GET /purchases/suppliers
{"rows":[{"id":"<id>","name":"Al-Hal market (vegetables)","phone":"","note":"","active":true},"…2 items"]}

### GET /costing/products
{"rows":[{"id":"<id>","nameAr":"حبش وشيدر","nameEn":"Turkey & Cheddar","category":{"nameAr":"ساندويشات","nameEn":"Sandwiches"},"price":2.5,"currency":"USD","priceUsd":2.5,"costUsd":1.359,"packagingUsd":0.05,"profitUsd":1.141,"marginPct":45.64,"hasRecipe":true,"lines":[{"itemId":"<id>","nameAr":"خبز","nameEn":"Bread roll","kind":"ingredient","unitCode":"pc","qty":1,"unitCostUsd":0.25,"costUsd":0.25},"…8 items"]},"…8 items"]}

### GET /costing/overheads?month=2026-10
{"month":"2026-10","itemsSold":36,"expensesUsd":6,"depreciationUsd":10,"salariesUsd":155.729,"fixedUsd":171.729,"perItemUsd":4.7703}

### GET /costing/prep
{"date":"2026-10-22","products":[{"productId":"<id>","nameAr":"حبش وشيدر","nameEn":"Turkey & Cheddar","qty":20,"unitCostUsd":1.359}],"ingredients":[{"itemId":"<id>","nameAr":"خبز","nameEn":"Bread roll","kind":"ingredient","unitCode":"pc","need":20,"have":88,"short":0},"…8 items"]}

### GET /clients
{"rows":[{"id":"<id>","type":"business","name":"Bean & Book Café","contactPerson":"Sara","phone":"+963 944 000 222","address":"","tierId":null,"tagId":"<id>","receiptLanguage":"ar","creditLimitUsd":100,"creditBlock":true,"note":"","active":true,"convertedAt":null,"balanceUsd":15,"loyalty":{"count":0,"progress":0,"buyQty":100,"available":0,"enabled":true},"subscription":null,"lastOrderDate":null},"…5 items"]}

### GET /clients/01a15b8f-3437-74e7-8c28-99ccdaa93038
{"client":{"id":"<id>","type":"business","name":"Focus Study Zone","contactPerson":"Rami","phone":"+963 944 000 111","address":"","tierId":"<id>","tagId":"<id>","receiptLanguage":"ar","creditLimitUsd":150,"creditBlock":false,"note":"","active":true,"convertedAt":null,"balanceUsd":0,"loyalty":{"count":10,"progress":10,"buyQty":100,"available":0,"enabled":true},"subscription":null,"lastOrderDate":"2026-10-21"},"loyalty":{"enabled":true,"buyQty":100,"freeQty":5,"count":10,"progress":10,"earned":0,"redeemed":0,"available":0},"analytics":{"byCategory":[{"categoryId":"<id>","nameAr":"ساندويشات","nameEn":"Sandwiches","qty":10}],"topProducts":[{"productId":"<id>","nameAr":"حبش وشيدر","nameEn":"Turkey & Cheddar","qty":10}],"monthly":[{"month":"2026-10","orders":1,"items":10,"totalUsd":24.3}],"ordersCount":1,"avgOrderUsd":24.3,"lastOrderDate":"2026-10-21","trials":0,"converted":false},"moves":[],"subscriptions":[],"prices":[],"recurring":[{"id":"<id>","clientId":"<id>","days":"0,1,2,3,4,5,6","linesJson":"[{\"productId\":\"01a15b8f-342a-7119-b487-7…","note":"","active":true,"lines":[{"productId":"<id>","qty":20,"optionIds":[]}]}]}

### GET /clients/01a15b8f-3437-74e7-8c28-99ccdaa93038/statement?from=2026-10-21&to=2026-10-21
{"client":{"id":"<id>","type":"business","name":"Focus Study Zone","contactPerson":"Rami","phone":"+963 944 000 111","address":"","tierId":"<id>","tagId":"<id>","receiptLanguage":"ar","creditLimitUsd":150,"creditBlock":false,"note":"","active":true,"convertedAt":null},"from":"2026-10-21","to":"2026-10-21","openingUsd":0,"closingUsd":0,"lines":[],"orders":[{"number":1,"date":"2026-10-21","total":24.3,"currency":"USD","itemsCount":10,"id":"<id>"}]}

### GET /clients/tiers
{"rows":[{"id":"<id>","nameAr":"عادي","nameEn":"Normal","discountPct":0,"sort":0},"…2 items"]}

### GET /clients/plans
{"rows":[{"id":"<id>","nameAr":"اشتراك شهري 20","nameEn":"Monthly 20","monthlyFee":45,"currency":"USD","discountPct":0,"includedItems":20,"active":true}]}

### GET /clients/calls
{"rows":[]}

### GET /orders?date=2026-10-21
{"rows":[{"id":"<id>","number":11,"businessDate":"2026-10-21","clientId":null,"type":"normal","employeeId":null,"fulfilment":"pickup","assignedTo":null,"status":"confirmed","paymentStatus":"paid","methodId":"<id>","currency":"USD","fxRate":115,"subtotal":1,"discount":0.5,"discountReason":"manual:50%","taxTotal":0,"taxesJson":"[]","deliveryFee":0,"total":0.5,"totalUsd":0.5,"costUsd":0.152,"itemsCount":1,"freeItems":0,"loyaltyFree":0,"subFree":0,"note":"","userId":"<id>","cancelledAt":null,"clientName":null,"method":{"nameAr":"كاش","nameEn":"Cash"},"userName":"Rami","assignedName":null},"…11 items"]}

### GET /orders/01a15b8f-378b-77f9-abec-1e6599d586bb
{"order":{"id":"<id>","number":11,"businessDate":"2026-10-21","clientId":null,"type":"normal","employeeId":null,"fulfilment":"pickup","assignedTo":null,"status":"confirmed","paymentStatus":"paid","methodId":"<id>","currency":"USD","fxRate":115,"subtotal":1,"discount":0.5,"discountReason":"manual:50%","taxTotal":0,"taxesJson":"[]","deliveryFee":0,"total":0.5,"totalUsd":0.5,"costUsd":0.152,"itemsCount":1,"freeItems":0,"loyaltyFree":0,"subFree":0,"note":"","userId":"<id>","cancelledAt":null,"clientName":null,"method":{"nameAr":"كاش","nameEn":"Cash"},"userName":"Rami","assignedName":null,"lines":[{"id":"<id>","orderId":"<id>","productId":"<id>","nameAr":"ليمون ونعناع","nameEn":"Lemon Mint","qty":1,"freeQty":0,"unitPrice":1,"optionsJson":"[]","lineTotal":1,"unitCostUsd":0.152,"options":[]}],"payments":[{"id":"<id>","kind":"order","orderId":"<id>","clientId":null,"methodId":"<id>","boxId":"<id>","amount":0.5,"currency":"USD","fxRate":115,"amountUsd":0.5,"note":"","userId":"<id>","businessDate":"2026-10-21"}],"taxes":[]}}

### GET /orders/01a15b8f-378b-77f9-abec-1e6599d586bb/receipt
{"receipt":{"business":{"nameAr":"جي جيز","nameEn":"JJ's deli shop","phone":"","address":"","logo":""},"printing":{"receiptWidthMm":80,"labelWidthMm":50,"labelHeightMm":30,"receiptFooterAr":"شكراً لكم","receiptFooterEn":"Thank you"},"order":{"id":"<id>","number":11,"businessDate":"2026-10-21","clientId":null,"type":"normal","employeeId":null,"fulfilment":"pickup","assignedTo":null,"status":"confirmed","paymentStatus":"paid","methodId":"<id>","currency":"USD","fxRate":115,"subtotal":1,"discount":0.5,"discountReason":"manual:50%","taxTotal":0,"taxesJson":"[]","deliveryFee":0,"total":0.5,"totalUsd":0.5,"costUsd":0.152,"itemsCount":1,"freeItems":0,"loyaltyFree":0,"subFree":0,"note":"","userId":"<id>","cancelledAt":null,"clientName":null,"method":{"nameAr":"كاش","nameEn":"Cash"},"userName":"Rami","assignedName":null,"taxes":[]},"lines":[{"id":"<id>","orderId":"<id>","productId":"<id>","nameAr":"ليمون ونعناع","nameEn":"Lemon Mint","qty":1,"freeQty":0,"unitPrice":1,"optionsJson":"[]","lineTotal":1,"unitCostUsd":0.152,"options":[]}],"client":null,"loyalty":null}}

### GET /orders/recurring/due
{"rows":[{"id":"<id>","clientId":"<id>","days":"0,1,2,3,4,5,6","linesJson":"[{\"productId\":\"01a15b8f-342a-7119-b487-7…","note":"","active":true,"clientName":"Focus Study Zone","lines":[{"productId":"<id>","qty":20,"optionIds":[]}],"orderedToday":true}]}

### GET /money/boxes
{"rows":[{"id":"<id>","nameAr":"الصندوق الرئيسي (كاش)","nameEn":"Main cash box","kind":"cash","currency":"USD","employeeId":null,"systemKey":"main_cash","active":true,"balance":163.9},"…3 items"]}

### GET /money/methods
{"rows":[{"id":"<id>","nameAr":"كاش","nameEn":"Cash","kind":"box","boxId":"<id>","systemKey":"cash","sort":0,"active":true},"…4 items"]}

### GET /money/boxes/01a15b8f-314a-755d-aac9-65c05c379232/moves
{"box":{"id":"<id>","nameAr":"الصندوق الرئيسي (كاش)","nameEn":"Main cash box","kind":"cash","currency":"USD","employeeId":null,"systemKey":"main_cash","active":true,"balance":163.9},"rows":[{"id":"<id>","boxId":"<id>","type":"salary","amount":-133.46,"currency":"USD","fxRate":115,"amountUsd":-133.459,"refType":"payroll","refId":"<id>","note":"Ahmad (sales & delivery) 2026-10","userId":"<id>","businessDate":"2026-10-21","userName":"Owner"},"…13 items"]}

### GET /money/reps
{"rows":[{"id":"<id>","name":"Ahmad (sales & delivery)","boxId":"<id>"}]}

### GET /days
{"rows":[{"id":"<id>","date":"2026-10-21","status":"open","closedAt":"2026-10-20T23:04:34.981Z","closedBy":"<id>","expectedCashUsd":297.86,"countedCashUsd":297.36,"differenceUsd":-0.5,"totalsJson":"{\"from\":\"2026-10-21\",\"to\":\"2026-10-21\",\"…","reopenedAt":"2026-10-20T23:04:34.995Z","reopenedBy":"<id>","totals":{"from":"2026-10-21","to":"2026-10-21","orders":10,"items":36,"freeItems":3,"salesUsd":68.82,"grossUsd":89,"discountUsd":20.18,"taxUsd":0,"deliveryUsd":0,"costUsd":37.591,"grossProfitUsd":31.229,"marginPct":45.3778,"expensesUsd":6,"wasteUsd":1,"depreciationUsd":0,"salariesUsd":0,"netUsd":24.229,"byStatus":[{"status":"free","n":2,"usd":0},"…3 items"],"byMethod":[{"methodId":null,"nameAr":null,"nameEn":null,"n":2,"usd":0},"…4 items"],"byType":[{"type":"normal","n":8,"items":32},"…3 items"],"byProduct":[{"productId":"<id>","nameAr":"حلوم وبندورة","nameEn":"Halloumi & Tomato","qty":13,"revenueUsd":29.25,"costUsd":11.791,"marginPct":59.6889},"…6 items"],"byCategory":[{"categoryId":"<id>","nameAr":"ساندويشات","nameEn":"Sandwiches","qty":32},"…3 items"],"byClient":[{"clientId":"<id>","name":"Corner Market","orders":2,"items":12,"salesUsd":24.75,"balanceUsd":0},"…5 items"],"expenses":[{"categoryId":"<id>","nameAr":"مواد غذائية","nameEn":"Food supplies","usd":6,"n":1}],"waste":[{"itemId":"<id>","nameAr":"خس","nameEn":"Lettuce","qty":1,"usd":1}],"depreciation":[],"trials":{"given":1,"converted":1,"rate":100},"cash":{"currency":"USD","expected":297.86,"counted":297.36,"difference":-0.5}}}]}

### GET /days/2026-10-21
{"day":{"id":"<id>","date":"2026-10-21","status":"open","closedAt":"2026-10-20T23:04:34.981Z","closedBy":"<id>","expectedCashUsd":297.86,"countedCashUsd":297.36,"differenceUsd":-0.5,"totalsJson":"{\"from\":\"2026-10-21\",\"to\":\"2026-10-21\",\"…","reopenedAt":"2026-10-20T23:04:34.995Z","reopenedBy":"<id>","totals":{"from":"2026-10-21","to":"2026-10-21","orders":10,"items":36,"freeItems":3,"salesUsd":68.82,"grossUsd":89,"discountUsd":20.18,"taxUsd":0,"deliveryUsd":0,"costUsd":37.591,"grossProfitUsd":31.229,"marginPct":45.3778,"expensesUsd":6,"wasteUsd":1,"depreciationUsd":0,"salariesUsd":0,"netUsd":24.229,"byStatus":[{"status":"free","n":2,"usd":0},"…3 items"],"byMethod":[{"methodId":null,"nameAr":null,"nameEn":null,"n":2,"usd":0},"…4 items"],"byType":[{"type":"normal","n":8,"items":32},"…3 items"],"byProduct":[{"productId":"<id>","nameAr":"حلوم وبندورة","nameEn":"Halloumi & Tomato","qty":13,"revenueUsd":29.25,"costUsd":11.791,"marginPct":59.6889},"…6 items"],"byCategory":[{"categoryId":"<id>","nameAr":"ساندويشات","nameEn":"Sandwiches","qty":32},"…3 items"],"byClient":[{"clientId":"<id>","name":"Corner Market","orders":2,"items":12,"salesUsd":24.75,"balanceUsd":0},"…5 items"],"expenses":[{"categoryId":"<id>","nameAr":"مواد غذائية","nameEn":"Food supplies","usd":6,"n":1}],"waste":[{"itemId":"<id>","nameAr":"خس","nameEn":"Lettuce","qty":1,"usd":1}],"depreciation":[],"trials":{"given":1,"converted":1,"rate":100},"cash":{"currency":"USD","expected":297.86,"counted":297.36,"difference":-0.5}},"closedByName":"Rami"},"report":{"from":"2026-10-21","to":"2026-10-21","orders":10,"items":36,"freeItems":3,"salesUsd":68.82,"grossUsd":89,"discountUsd":20.18,"taxUsd":0,"deliveryUsd":0,"costUsd":37.591,"grossProfitUsd":31.229,"marginPct":45.3778,"expensesUsd":6,"wasteUsd":1,"depreciationUsd":0.3333,"salariesUsd":155.729,"netUsd":-131.8333,"byStatus":[{"status":"free","n":2,"usd":0},"…3 items"],"byMethod":[{"methodId":null,"nameAr":null,"nameEn":null,"n":2,"usd":0},"…4 items"],"byType":[{"type":"normal","n":8,"items":32},"…3 items"],"byProduct":[{"productId":"<id>","nameAr":"حلوم وبندورة","nameEn":"Halloumi & Tomato","qty":13,"revenueUsd":29.25,"costUsd":11.791,"marginPct":59.6889},"…6 items"],"byCategory":[{"categoryId":"<id>","nameAr":"ساندويشات","nameEn":"Sandwiches","qty":32},"…3 items"],"byClient":[{"clientId":"<id>","name":"Corner Market","orders":2,"items":12,"salesUsd":24.75,"balanceUsd":0},"…5 items"],"expenses":[{"categoryId":"<id>","nameAr":"مواد غذائية","nameEn":"Food supplies","usd":6,"n":1}],"waste":[{"itemId":"<id>","nameAr":"خس","nameEn":"Lettuce","qty":1,"usd":1}],"depreciation":[{"id":"<id>","nameAr":"برّاد","nameEn":"Fridge","usd":0.3333}],"trials":{"given":1,"converted":1,"rate":100}},"mainBox":{"id":"<id>","nameAr":"الصندوق الرئيسي (كاش)","nameEn":"Main cash box","currency":"USD","expected":163.9},"reps":[]}

### GET /expenses
{"rows":[{"id":"<id>","date":"2026-10-21","categoryId":"<id>","itemId":"<id>","amount":6,"currency":"USD","fxRate":115,"amountUsd":6,"boxId":"<id>","assetId":null,"note":"gasket","userId":"<id>","category":{"nameAr":"مواد غذائية","nameEn":"Food supplies"},"item":{"nameAr":"صيانة البرّاد","nameEn":"Fridge repair"},"box":{"nameAr":"الصندوق الرئيسي (كاش)","nameEn":"Main cash box"},"userName":"Owner"}]}

### GET /assets
{"rows":[{"id":"<id>","nameAr":"برّاد","nameEn":"Fridge","price":600,"currency":"USD","fxRate":115,"priceUsd":600,"purchaseDate":"2026-10-21","lifeMonths":60,"salvageUsd":0,"note":"","active":true,"monthlyUsd":10,"monthsUsed":1,"accumulatedUsd":10,"bookValueUsd":590}]}

### GET /people/employees
{"rows":[{"id":"<id>","name":"Ahmad (sales & delivery)","phone":"","jobTitle":"Sales & delivery","userId":null,"payModel":"both","baseSalary":150,"currency":"USD","commissionPerClientUsd":5,"commissionPct":3,"staffDiscountPct":30,"isDeliveryRep":true,"active":true,"userName":null}]}

### GET /people/advances
{"rows":[{"id":"<id>","employeeId":"<id>","date":"2026-10-21","amount":20,"currency":"USD","fxRate":115,"amountUsd":20,"remainingUsd":0,"boxId":"<id>","note":"","employeeName":"Ahmad (sales & delivery)"}]}

### GET /people/payroll/2026-10
{"month":"2026-10","status":"paid","run":{"id":"<id>","month":"2026-10","status":"paid","paidAt":"2026-10-20T23:04:35.032Z","boxId":"<id>"},"rows":[{"id":"<id>","runId":"<id>","employeeId":"<id>","baseUsd":150,"commissionUsd":5.729,"advancesUsd":20,"staffPurchasesUsd":2.27,"netUsd":133.459,"detailsJson":"{\"deliveredSalesUsd\":24.3,\"deliveredOrde…","name":"Ahmad (sales & delivery)","details":{"deliveredSalesUsd":24.3,"deliveredOrders":1,"convertedClients":1}}]}

### GET /reports/dashboard
{"date":"2026-10-21","today":{"from":"2026-10-21","to":"2026-10-21","orders":10,"items":36,"freeItems":3,"salesUsd":68.82,"grossUsd":89,"discountUsd":20.18,"taxUsd":0,"deliveryUsd":0,"costUsd":37.591,"grossProfitUsd":31.229,"marginPct":45.3778,"expensesUsd":6,"wasteUsd":1,"depreciationUsd":0.3333,"salariesUsd":155.729,"netUsd":-131.8333,"byStatus":[{"status":"free","n":2,"usd":0},"…3 items"],"byMethod":[{"methodId":null,"nameAr":null,"nameEn":null,"n":2,"usd":0},"…4 items"],"byType":[{"type":"normal","n":8,"items":32},"…3 items"],"byProduct":[{"productId":"<id>","nameAr":"حلوم وبندورة","nameEn":"Halloumi & Tomato","qty":13,"revenueUsd":29.25,"costUsd":11.791,"marginPct":59.6889},"…6 items"],"byCategory":[{"categoryId":"<id>","nameAr":"ساندويشات","nameEn":"Sandwiches","qty":32},"…3 items"],"byClient":[{"clientId":"<id>","name":"Corner Market","orders":2,"items":12,"salesUsd":24.75,"balanceUsd":0},"…5 items"],"expenses":[{"categoryId":"<id>","nameAr":"مواد غذائية","nameEn":"Food supplies","usd":6,"n":1}],"waste":[{"itemId":"<id>","nameAr":"خس","nameEn":"Lettuce","qty":1,"usd":1}],"depreciation":[{"id":"<id>","nameAr":"برّاد","nameEn":"Fridge","usd":0.3333}],"trials":{"given":1,"converted":1,"rate":100}},"week":[{"date":"2026-10-15","salesUsd":0,"orders":0},"…7 items"],"recent":[{"id":"<id>","number":11,"businessDate":"2026-10-21","clientId":null,"type":"normal","employeeId":null,"fulfilment":"pickup","assignedTo":null,"status":"confirmed","paymentStatus":"paid","methodId":"<id>","currency":"USD","fxRate":115,"subtotal":1,"discount":0.5,"discountReason":"manual:50%","taxTotal":0,"taxesJson":"[]","deliveryFee":0,"total":0.5,"totalUsd":0.5,"costUsd":0.152,"itemsCount":1,"freeItems":0,"loyaltyFree":0,"subFree":0,"note":"","userId":"<id>","cancelledAt":null,"clientName":null},"…11 items"],"alerts":{"expired":[],"expiresToday":[],"lowStock":[],"nearCreditLimit":[],"repCash":[]},"boxes":[{"id":"<id>","nameAr":"الصندوق الرئيسي (كاش)","nameEn":"Main cash box","kind":"cash","currency":"USD","balance":163.9,"todayIn":163.9},"…3 items"],"unpaid":[]}

### GET /reports/range?from=2026-10-21&to=2026-10-21
{"from":"2026-10-21","to":"2026-10-21","orders":10,"items":36,"freeItems":3,"salesUsd":68.82,"grossUsd":89,"discountUsd":20.18,"taxUsd":0,"deliveryUsd":0,"costUsd":37.591,"grossProfitUsd":31.229,"marginPct":45.3778,"expensesUsd":6,"wasteUsd":1,"depreciationUsd":0.3333,"salariesUsd":155.729,"netUsd":-131.8333,"byStatus":[{"status":"free","n":2,"usd":0},"…3 items"],"byMethod":[{"methodId":null,"nameAr":null,"nameEn":null,"n":2,"usd":0},"…4 items"],"byType":[{"type":"normal","n":8,"items":32},"…3 items"],"byProduct":[{"productId":"<id>","nameAr":"حلوم وبندورة","nameEn":"Halloumi & Tomato","qty":13,"revenueUsd":29.25,"costUsd":11.791,"marginPct":59.6889},"…6 items"],"byCategory":[{"categoryId":"<id>","nameAr":"ساندويشات","nameEn":"Sandwiches","qty":32},"…3 items"],"byClient":[{"clientId":"<id>","name":"Corner Market","orders":2,"items":12,"salesUsd":24.75,"balanceUsd":0},"…5 items"],"expenses":[{"categoryId":"<id>","nameAr":"مواد غذائية","nameEn":"Food supplies","usd":6,"n":1}],"waste":[{"itemId":"<id>","nameAr":"خس","nameEn":"Lettuce","qty":1,"usd":1}],"depreciation":[{"id":"<id>","nameAr":"برّاد","nameEn":"Fridge","usd":0.3333}],"trials":{"given":1,"converted":1,"rate":100},"unpaid":[]}

### GET /system/network
{"lanAccess":false,"addresses":["http://192.0.2.2:4397"],"port":4397,"dataDir":"/tmp/jjs-full","listeningOnLan":false}

### GET /system/sync
{"enabled":false,"supabaseUrl":"","hasKey":false,"status":{"lastRunAt":null,"lastOkAt":null,"lastError":null,"pushed":0},"pending":533}

### GET /fx/current
{"rate":115,"source":"manual","manualRate":115,"apiConfigured":false,"lastError":null}

### GET /taxes
{"taxes":[]}

### GET /lookups?type=expense_category
{"items":[{"id":"<id>","listType":"expense_category","nameAr":"مواد غذائية","nameEn":"Food supplies","sort":0,"active":true},"…5 items"],"canAdd":true}

### POST /orders/quote
{"currency":"USD","rate":115,"client":{"id":"<id>","name":"Focus Study Zone","creditLimitUsd":150,"creditBlock":false,"balanceUsd":0},"employee":null,"lines":[{"productId":"<id>","nameAr":"سلطة سيزر","nameEn":"Caesar Salad","qty":2,"freeQty":0,"basePrice":3,"specialPrice":false,"options":[],"unitPrice":3,"lineTotal":6}],"subtotal":6,"discount":0.6,"discountPct":10,"discountReason":"tier:10%","freeItems":0,"subFree":0,"loyaltyFree":0,"taxes":[],"taxTotal":0,"deliveryFee":0,"total":5.4,"totalUsd":5.4,"itemsCount":2,"loyalty":{"enabled":true,"buyQty":100,"freeQty":5,"count":10,"progress":10,"earned":0,"redeemed":0,"available":0},"subscription":null}

