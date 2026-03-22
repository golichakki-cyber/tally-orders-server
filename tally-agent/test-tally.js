const axios = require('axios');

const TALLY_URL = 'http://localhost:9000';

// Note: Ensure Ledger "Cash" and "Sales" and Stock Item "20L Water Can" exist in Tally.
const xml = `
<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Import Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <IMPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>Vouchers</REPORTNAME>
                <STATICVARIABLES>
                    <SVCURRENTCOMPANY>Water Service_s</SVCURRENTCOMPANY>
                </STATICVARIABLES>
            </REQUESTDESC>
            <REQUESTDATA>
                <TALLYMESSAGE xmlns:UDF="TallyUDF">
                    <VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
                        <DATE>20260315</DATE>
                        <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
                        <PARTYLEDGERNAME>Cash</PARTYLEDGERNAME>
                        <NARRATION>Test Order from Agent</NARRATION>
                        <BASICBUYERADDRESS.LIST>
                            <BASICBUYERADDRESS>Address Line 1</BASICBUYERADDRESS>
                        </BASICBUYERADDRESS.LIST>
                        
                        <!-- Party Entry -->
                        <ALLLEDGERENTRIES.LIST>
                            <LEDGERNAME>Cash</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                            <AMOUNT>-150</AMOUNT>
                        </ALLLEDGERENTRIES.LIST>

                        <INVENTORYENTRIES.LIST>
                            <STOCKITEMNAME>20L Water Can</STOCKITEMNAME>
                            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                            <RATE>150</RATE>
                            <AMOUNT>150</AMOUNT>
                            <ACTUALQTY> 1 Nos</ACTUALQTY>
                            <BILLEDQTY> 1 Nos</BILLEDQTY>
                            
                            <!-- This sub-list is CRITICAL to avoid "No Accounting Allocations" error -->
                            <ACCOUNTINGALLOCATIONS.LIST>
                                <LEDGERNAME>Sales</LEDGERNAME>
                                <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                                <AMOUNT>150</AMOUNT>
                            </ACCOUNTINGALLOCATIONS.LIST>
                        </INVENTORYENTRIES.LIST>
                    </VOUCHER>
                </TALLYMESSAGE>
            </REQUESTDATA>
        </IMPORTDATA>
    </BODY>
</ENVELOPE>
`;

async function testTally() {
    try {
        console.log("Sending to Tally...");
        const res = await axios.post(TALLY_URL, xml, {
            headers: { 'Content-Type': 'text/xml' }
        });
        console.log("Tally Response:");
        console.log(res.data);
    } catch (err) {
        console.error("Error:", err.message);
    }
}

testTally();
