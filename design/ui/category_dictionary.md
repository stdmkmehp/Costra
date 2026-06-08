# Costra - 系统默认分类数据字典 (Data Dictionary)

## 支出类别 (Expense Categories)
*(注：同一二级分类可能出现在不同的一级分类下，以满足基于场景的记账需求，例如“旅行”下的“餐饮”与日常“餐饮”)*

### 1. 🍔 餐饮 (Food & Dining)
*   **餐饮** (Dining - 默认)
*   **外卖** (Delivery)
*   **买菜** (Groceries)
*   **零食** (Snacks)
*   **饮料** (Beverages)
*   **酒水** (Drinks)

### 2. 🚇 交通 (Transportation)
*   **交通** (Transit - 默认)
*   **打车** (Taxi/Ride-hailing)
*   **公交** (Bus)
*   **地铁** (Subway)
*   **火车/高铁** (Train)
*   **机票** (Flight)

### 3. 🛍️ 购物 (Shopping)
*   **购物** (Shopping - 默认)
*   **日用** (Daily necessities)
*   **服饰** (Clothing & Accessories)
*   **数码** (Electronics)
*   **零食** (Snacks)
*   **纸巾** (Tissues)
*   **饮料** (Beverages)

### 4. 🛒 生活 (Lifestyle & Daily)
*   **生活** (Lifestyle - 默认)
*   **买菜** (Groceries)
*   **护肤美容** (Beauty & Skincare)
*   **宠物** (Pets)
*   **住房** (Housing/Rent)
*   **水电煤** (Utilities)
*   **话费网费** (Phone & Internet)
*   **物业维修** (Maintenance)
*   **家居** (Home goods)

### 5. ✈️ 旅行 (Travel)
*   **旅行** (Travel - 默认)
*   **机票** (Flight)
*   **酒店** (Hotel)
*   **交通** (Transit)
*   **火车** (Train)
*   **餐饮** (Dining)

### 6. 🎭 文娱 (Culture & Entertainment)
*   **文娱** (Culture/Ent - 默认)
*   **游戏** (Games)
*   **电影** (Movies)
*   **门票** (Tickets)
*   **教育** (Education)
*   **医疗** (Medical/Health)
*   **书籍** (Books)
*   **运动** (Sports/Fitness)

### 7. 🚗 汽车 (Auto)
*   **汽车** (Auto - 默认)
*   **加油** (Gas/Fuel)
*   **停车** (Parking)
*   **保养** (Maintenance)
*   **过路费** (Tolls)

### 8. 🔧 其他 (Others)
*   **其他** (Others - 默认)
*   **人情** (Social/Gifts)
*   **捐赠** (Donations)
*   **丢失** (Lost)

---

## 收入类别 (Income Categories)

### 1. 💰 职业收入
*   **工资** (Salary - 默认)
*   **奖金** (Bonus)
*   **兼职** (Part-time)
*   **报销** (Reimbursement)

### 2. 📈 投资与资产
*   **理财** (Investment - 默认)
*   **收租** (Rent Income)
*   **利息** (Interest)

### 3. 🧧 意外所得
*   **人情** (Gifts/Red Packets - 默认)
*   **中奖** (Lottery/Windfall)
*   **闲置出售** (Second-hand Sales)
*   **其他** (Others)

---

## 📌 重叠分类去重与直选默认归属规则

为了保持记账界面的极简与高效，对于在多个一级分类下重叠出现的二级分类（如“机票”、“餐饮”、“零食”），系统在底层执行以下交互规则：

1. **界面展示去重 (Deduplication)**：在初始的全局二级分类展示区中，同名的二级分类**仅展示一次**。
2. **越级直选归属 (Default Resolution)**：当用户越过一级分类，直接点击这些被去重的二级分类图标时，系统会默认将其分配给**最日常/最高频**的一级分类（详见下表）。
3. **精准场景归属**：若用户希望将其归入非默认场景（例如将“餐饮”归入“旅行”），必须采用标准流程：先点击上方的一级分类“旅行”展开其子类，再点击下方展开的“餐饮”。

### 默认直选归属映射表
*   **直选“餐饮”** -> 默认归属：`餐饮-餐饮`（而非 旅行-餐饮）
*   **直选“机票”** -> 默认归属：`交通-机票`（而非 旅行-机票）
*   **直选“零食”** -> 默认归属：`餐饮-零食`（而非 购物-零食）
*   **直选“买菜”** -> 默认归属：`餐饮-买菜`（而非 生活-买菜）
*   **直选“饮料”** -> 默认归属：`餐饮-饮料`（而非 生活-饮料）

