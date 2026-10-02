const KEY='khodroto:compare'
export function comparedCars(){try{return JSON.parse(localStorage.getItem(KEY)||'[]').filter(Boolean).slice(0,4)}catch{return[]}}
export function isCompared(id){return comparedCars().some(car=>String(car.id)===String(id))}
export function toggleCompared(car){const items=comparedCars(),index=items.findIndex(item=>String(item.id)===String(car.id));let next;if(index>=0)next=items.filter((_,i)=>i!==index);else{if(items.length>=4)return{items,added:false,full:true};next=[...items,car]}localStorage.setItem(KEY,JSON.stringify(next));window.dispatchEvent(new Event('khodroto:compare'));return{items:next,added:index<0,full:false}}
export function clearCompared(){localStorage.removeItem(KEY);window.dispatchEvent(new Event('khodroto:compare'))}
