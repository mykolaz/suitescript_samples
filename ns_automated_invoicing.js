/**
 * 
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 * @NModuleScope public
 * 
 */

 define(['N/search', 'N/record', 'N/format'], function(search, record, format) {
    function execute(context) {

    search.load({
        id: 'customsearch_automated_invoicing'
    }).run().each(function(result) {
        
        // Log script start
        log.debug({
            title: 'Automated Invoicing is running'
        });

        salesOrderId = result.id;

        // Run search on customer deposits associated with the sales order
        var customer_deposits_results = search.create({
            type: 'customerdeposit',
            columns: ['tranid', 'paymentmethod'],
            filters: [
                ["mainline", search.Operator.IS, true], "and",
                ['createdfrom', search.Operator.ANYOF, salesOrderId]
            ]
        }).run().getRange({start: 0, end:10});

        // Set whether the payment is external
        var external = false

        // Check the quantity of deposits and perform actions based on each
        if (customer_deposits_results.length > 1) {

            var count_payments = 0
            var payment_types = []

            log.debug({
                title: 'Original External Value: ' + external,
                details: 'More than 1 Customer Deposits'
            });

            // Find any potential payment types
            for (var i = 0; i < customer_deposits_results.length; i++) {
                
                var customer_deposit_record = record.load({
                    type: record.Type.CUSTOMER_DEPOSIT,
                    id: customer_deposits_results[i].id
                });

                var payment_type = customer_deposit_record.getValue({
                    fieldId: 'paymentmethod'
                });

                log.debug({
                    title: 'Payment Type',
                    details: payment_type
                });

                var payment_type_search = search.create({
                    type: record.Type.PAYMENT_METHOD,
                    columns: ['name', 'methodtype'],
                    filters: [
                        ['name', search.Operator.IS, payment_type]
                    ]
                });

                // Get the result of the payment method
                var payment_types_results = payment_type_search.run();

                log.debug({
                    title: 'Method Type',
                    details: payment_types_results.methodtype
                });

                payment_types.push(payment_types_results.methodtype)

            }

            // Check to make sure that at least one payment type is external - then mark whole order as external
            for (var et = 0; et < payment_types.length; et++) {
                if (payment_types[et] == 6) {
                    count_payments += 1
                } else {
                    count_payments += 0
                }
            }

            log.debug({
                title: 'Payments Count',
                details: count_payments
            });

            if (count_payments > 0) {
                external = true
            }


        // If only one customer deposit exists
        } else if (customer_deposits_results.length == 1) {

            log.debug({
                title: "Customer Deposit Results: ",
                details: customer_deposits_results
            });

            var customer_deposit_record = record.load({
                type: record.Type.CUSTOMER_DEPOSIT,
                id: customer_deposits_results[0].id
            });

            log.debug({
                title: 'Payments ID',
                details: customer_deposits_results[0].id
            });

            var payment_type = customer_deposit_record.getValue({
                fieldId: 'paymentmethod'
            });

            log.debug({
                title: 'Payment Method',
                details: payment_type
            });

            var payment_type_search = search.create({
                type: 'paymentmethod',
                columns: ['internalid'],
                filters: [
                    ['internalid', search.Operator.IS, payment_type],
                ]
            });

            var payment_type_results = payment_type_search.run().getRange({start: 0, end:10});

            payment_result = payment_type_results[0];

            log.debug({
                title: 'Payment Results Single Payment',
                details: payment_result.id
            });
            
            var payment_type = record.load({
                type: record.Type.PAYMENT_METHOD,
                id: payment_result.id
            });

            var payment_method = payment_type.getValue({
                fieldId: 'methodtype'
            });

            log.debug({
                title: 'Payment Method ' + payment_method,
                details: ''
            });
    
            if (payment_method == 6) {
                external = true
            }
            
        } else {

            // Ensure external flag is set appropriately
            external = false

        }
        
        log.debug({
            title: "External: " + external
        })

        // Load the Sales Order record from Id
        try {
            var salesOrder = record.load({
                type: record.Type.SALES_ORDER,
                id: result.id
            });

        } catch (err) {
            return;
        }

        // Get SO status
        var salesOrderStatus = salesOrder.getValue({
            fieldId: 'status'
        });

        // Get SO External Id
        var salesOrderNumber = salesOrder.getValue({
            fieldId: 'tranid'
        });

        log.debug({
            title: 'Sales Order ID: ' + salesOrderId,
            details: 'Sales Order: ' + salesOrderNumber
        });

        var customerId = salesOrder.getValue({
            fieldId: 'companyid'
        });
        
        // Load the customer
        var customer = record.load({
            type: record.Type.CUSTOMER,
            id: customerId
        });

        // TODO: Create customer field called 'Allow partial Billing'
        var partialBillingAllowed = customer.getValue({
            fieldId: 'custentity_allow_partial_invoicing'
        });

        // Log whether partial billing is allowed on the customer or not
        log.debug({
            title: 'Partial Billing',
            details: partialBillingAllowed
        });

        // Load Item Fulfillment record by searching for all the related records to the salesOrder
        var itemFulfillmentSearch = search.create({
            type: 'itemfulfillment',
            columns: ['tranid'],
            filters: [
                ["mainline", search.Operator.IS, true], "and",
                ['createdfrom', search.Operator.ANYOF, salesOrderId], "and",
                ['status', search.Operator.ANYOF, "ItemShip:C"]
            ]
        });

        var itemFulfillmentResults = itemFulfillmentSearch.run().getRange({start: 0, end: 10});

        /**
         * Check for information about the customer and item fulfillments
         * If partial billing is not allowed, then we don't expect more than one Item Fulfillment existing
         */

        log.debug({
            title: 'Item Fulfillment Results Length : ' + itemFulfillmentResults.length
        });

        log.debug({
            title: "SO Status: " + salesOrderStatus
        });

        // Ensure externals orders are invoices only when they are fully fulfilled (all item fulfillment stauts == C:Shipped)
        if (external == true && salesOrderStatus == 'Pending Billing') {

            // Begin record transformation from salesOrder to invoice
            var invoice = record.transform({
                fromType: record.Type.SALES_ORDER,
                fromId: salesOrderId,
                toType: record.Type.INVOICE,
                isDynamic: true
            });

            var invoiceId = invoice.save({
                enableSourcing: true,
                ignoreMandatoryFields: false
            });

            log.debug({
                title: "Invoice Saved: " + invoiceId
            });


        }

        else if (((itemFulfillmentResults.length > 1 && !partialBillingAllowed) || (itemFulfillmentResults.length === 0)) && external == false) {

            log.debug({
                title: 'Length: ' + itemFulfillmentResults.length + ' | Partial Billing: ' + partialBillingAllowed
            })

            // Begin record transformation from salesOrder to invoice
            var invoice = record.transform({
                fromType: record.Type.SALES_ORDER,
                fromId: salesOrderId,
                toType: record.Type.INVOICE,
                isDynamic: true
            });

            var itemCount = invoice.getLineCount({
                sublistId: 'item'
            });

            // Ensure we don't invoice 0 quantity items

            for (i = itemCount - 1; i >= 0; i--) {

                invoice.selectLine({
                    sublistId: 'item',
                    line: i
                });

                var invoiceItemCount = invoice.getCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity'
                });

                log.debug({
                    title: 'Quantity: ' + invoiceItemCount
                });

                if (invoiceItemCount === 0) {
                    invoice.removeLine({
                        sublistId: 'item',
                        line: i
                    });
                }

            }

            finalInvoiceItemCount = invoice.getLineCount({
                sublistId: 'item'
            });

            if (finalInvoiceItemCount > 0){

                var invoiceId = invoice.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: false
                });

            }

            log.debug({
                title: "Invoice Saved: " + invoiceId
            });

        }
        

        /**
         * Check for item fulfillments already existing, and only allow for partially billed items
         */
        else if ((itemFulfillmentResults.length === 1 || (itemFulfillmentResults.length > 1 & partialBillingAllowed)) && external == false) {
            
            for (count = 0; count < itemFulfillmentResults.length; count++) {

                // Initialize some values
                var totalQuantity = 0;
                var totalQuantityBilled = 0;

                var itemFulfillmentId = itemFulfillmentResults[count].id;

                log.debug({
                    title: "Item Fulfillment ID: " + itemFulfillmentId
                });

                // Get quantity of lines on the salesOrder
                var salesOrderLineCount = salesOrder.getLineCount({
                    sublistId: 'item'
                });

                // Get item quantities ordered and quantities billed
                for (var lineNumber = 0; lineNumber < salesOrderLineCount; lineNumber++) {
                    
                    // Get line quantity
                    var itemQuantity = salesOrder.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'quantity',
                        line: lineNumber
                    });

                    // Get billed quantity
                    var quantityBilled = salesOrder.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'quantitybilled',
                        line: lineNumber
                    });

                    totalQuantity += itemQuantity;
                    totalQuantityBilled += quantityBilled;

                }

                log.debug({
                    title: 'Total Quantity: ' + totalQuantity
                });

                log.debug({
                    totle: 'Total Quantity Billed: ' + totalQuantityBilled
                });

                if (totalQuantityBilled < totalQuantity) {

                    var itemFulfillment = record.load({
                        type: record.Type.ITEM_FULFILLMENT,
                        id: itemFulfillmentId
                    });

                    // Number of items needs to be fulfilled in an itemFulfillment
                    var itemFulfillmentItemCount = itemFulfillment.getLineCount({
                        sublistId: 'item'
                    });

                    var itemFulfillmentTransactionDate = itemFulfillment.getValue({
                        fieldId: 'trandate'
                    });

                    log.debug({
                        title: 'Item Fulfillment transaction date: ' + itemFulfillmentTransactionDate
                    });

                    // Initialize order line quantity dictionary/map
                    var orderLineQuantity = {};

                    for (var i = 0; i < itemCount; i++) {

                        // Index of all the items on an itemFulfillment
                        var itemFulfillmentOrderLine     = itemFulfillment.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'orderline',
                            line: i
                        });

                        var itemFulfillmentLineQuantity = itemFulfillment.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'quantity',
                            line: i
                        });

                        orderLineQuantity[itemFulfillmentOrderLine] = itemFulfillmentLineQuantity;

                    }

                    var invoice = record.transform({
                        fromType: record.Type.SALES_ORDER,
                        fromId: salesOrderId,
                        toType: record.Type.INVOICE,
                        isDynamic: true
                    });

                    invoice.setValue({
                        fieldId: 'trandate',
                        value: itemFulfillmentTransactionDate
                    });

                    var invoiceItemCount = invoice.getLineCount({
                        sublistId: 'item'
                    });

                    for (var i = invoiceItemCount - 1; i >= 0; i--) {
                        invoice.selectLine({
                            sublistId: 'item',
                            line: i
                        });

                        var invoiceOrderLine = invoice.getCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'orderline'
                        });

                        var invoiceItemId = invoice.getCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'item'
                        }); 

                        log.debug({
                            title: 'Line ID: ' + invoiceItemId,
                            details: 'Item: ' + invoiceItemId.itemid
                        });

                        var itemFulfillmentQuantity = orderLineQuantity[invoiceOrderLine] || 0;

                        if ((itemFulfillmentQuantity == 0) || (itemFulfillmentQuantity == null)) {

                            // Check if the item is fulfillable
                            // TODO: Get item info - need to load it
                            var isItemFulfillable = invoiceItemId.isfulfillable;
                            
                            if (isItemFulfillable == 'T') {
                                invoice.removeLine({
                                    sublistId: 'item',
                                    line: i
                                });
                            }

                        } else {

                            var invoiceItemQuantity = invoice.getCurrentSublistValue({
                                sublistId: 'item',
                                fieldId: 'quantity'
                            });

                            if (itemFulfillmentQuantity < invoiceItemQuantity) {
                                
                                var invoiceLineRate = invoice.getCurrentSublistValue({
                                    sublistId: 'item',
                                    fieldId: 'rate'
                                });

                                var invoiceLineAmount = invoice.getCurrentSublistValue({
                                    sublistId: 'item',
                                    fieldId: 'amount'
                                });

                                invoice.setCurrentSublistValue({
                                    sublistId: 'item',
                                    fieldId: 'quantity'
                                });

                                if (!invoiceLineRate) {

                                    var calculatedInvoiceLineAmount = (invoiceLineAmount / invoiceItemQuantity) * itemFulfillmentQuantity;

                                    invoice.setCurrentSublistValue({
                                        sublistId: 'item',
                                        fieldId: 'amount',
                                        value: calculatedInvoiceLineAmount
                                    });

                                }
                                
                            }

                        }

                    }

                    var invoiceItemLinesCount = invoice.getLineCount({
                        sublistId: 'item'
                    });

                    var invoiceTotal = invoice.getValue({
                        fieldId: 'total'
                    });

                    if (invoiceItemLinesCount > 0) {

                        try {
                            var invoiceId = invoice.save({
                                enableSourcing: true,
                                ignoreMandatoryFields: false
                            });
                        } catch (error) {
                            throw new Error('Failed to save the invoice for Sales Order ' + salesOrderNumber + ' (Internal Id: ' + salesOrderId + ')');
                        }

                    }

                    log.debug({
                        title: 'Invoice Saved: ' + invoice.tranid
                    });

                }

            }

        }

        return true;

    })};

    return {
        execute: execute
    };

 });
