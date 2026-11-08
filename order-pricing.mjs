// Indian state/union territory delivery charges used for the checkout preview.
// Supabase independently checks the shipping state and calculates the authoritative fee.
export const INDIAN_STATES=["Andaman and Nicobar Islands","Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chandigarh","Chhattisgarh","Dadra and Nagar Haveli and Daman and Diu","Delhi","Goa","Gujarat","Haryana","Himachal Pradesh","Jammu and Kashmir","Jharkhand","Karnataka","Kerala","Ladakh","Lakshadweep","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Puducherry","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal"];
export function deliveryFeeForState(value){
  const normalized=String(value||"").trim().toLowerCase();
  if(!normalized)return null;
  const state=INDIAN_STATES.find(item=>item.toLowerCase()===normalized);
  if(!state)return null;
  return state==="Tamil Nadu"?50:100;
}

/**
 * Customer-facing GST preview for shipping from Tamil Nadu.
 * The authoritative server applies the same destination split at reservation.
 * Merchant is responsible for verifying product-specific HSN and applicable rates.
 */
export function gstComponentsForState(taxableAmount,state){
  const normalized=String(state||"").trim().toLowerCase();
  const match=INDIAN_STATES.find(name=>name.toLowerCase()===normalized);
  if(!match||!Number.isFinite(taxableAmount)||taxableAmount<0)return null;
  const round=amount=>Math.round((amount+Number.EPSILON)*100)/100;
  if(match==="Tamil Nadu")return {
    cgst:round(taxableAmount*.015),sgst:round(taxableAmount*.015),igst:0,mode:"intra"
  };
  return {cgst:0,sgst:0,igst:round(taxableAmount*.03),mode:"inter"};
}
