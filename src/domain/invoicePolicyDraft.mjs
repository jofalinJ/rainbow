// Per-line tax arithmetic experiment for accountant validation. Paise only.
// This module is not connected to the existing checkout.
export function calculateTaxLine({quantity,unitPaise,discountPaise=0,rateBps,inclusive,intraState}){
 if(!Number.isInteger(quantity)||quantity<=0||quantity>10000 ||
 !Number.isSafeInteger(unitPaise)||unitPaise<0 ||
 !Number.isSafeInteger(discountPaise)||discountPaise<0 ||
 !Number.isInteger(rateBps)||rateBps<0||rateBps>10000 ||
 typeof inclusive!=="boolean"||typeof intraState!=="boolean")
 throw new RangeError("Invalid invoice line or missing approved tax parameters");
 const gross=BigInt(quantity)*BigInt(unitPaise)-BigInt(discountPaise);
 if(gross<0n)throw new RangeError("Discount exceeds amount");
 const round=(value,div)=>(value+div/2n)/div;
 const taxable=inclusive?round(gross*10000n,10000n+BigInt(rateBps)):gross;
 const tax=inclusive?gross-taxable:round(taxable*BigInt(rateBps),10000n);
 const cgst=intraState?round(tax,2n):0n,sgst=intraState?tax-cgst:0n;
 const result={taxablePaise:Number(taxable),cgstPaise:Number(cgst),
 sgstPaise:Number(sgst),igstPaise:intraState?0:Number(tax),
 totalPaise:Number(taxable+tax)};
 if(Object.values(result).some(v=>!Number.isSafeInteger(v)))throw new RangeError("Amount overflow");
 return result;
}
export function formatInvoiceSerial({counter,year,sequence}){
 if(!/^[A-Z0-9]$/.test(counter)||!Number.isInteger(year)||year<2000||year>2099||
 !Number.isInteger(sequence)||sequence<1||sequence>999999)throw new RangeError("Invalid invoice series");
 const code="RGC-"+counter+"-"+String(year%100).padStart(2,"0")+String(sequence).padStart(6,"0");
 if(code.length>16)throw new RangeError("Serial exceeds 16 characters");
 return code;
}
