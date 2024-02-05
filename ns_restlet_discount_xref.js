/**
 * 
 * @NApiVersion 2.x
 * @NScriptType Restlet
 * 
 */

define(['N/search'], 

    function(search) {

        function _get_discount_xref() {

            var discounts_search = search.load({
                id: 'customsearch_discount_cr',
            });
            
            var search_results = discounts_search.run();
            
            return JSON.stringify(search_results);

        }
    
        return {
            get: _get_discount_xref
        };
});
