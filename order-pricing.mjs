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
