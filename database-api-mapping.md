# Database to API Field Mapping Documentation

## Field Name Mismatches Between Database and API

### Products Table
| Database Column | API Field | Frontend Uses |
|-----------------|-----------|---------------|
| product_id | productId | productId |
| cost_price | costPrice | tax (legacy) |
| default_sale_price | defaultSalePrice | price |
| stock_limit | stockLimit | stockLimit |

### Customers Table
| Database Column | API Field |
|-----------------|-----------|
| loyalty_points | loyaltyPoints |
| tier_id | tierId |
| total_spent | totalSpent |

### Orders Table
| Database Column | API Field |
|-----------------|-----------|
| customer_id | customerId |
| payment_method | paymentMethod |
| location_id | locationId |

### Locations Table  
| Database Column | API Field |
|-----------------|-----------|
| zip_code | zipCode |
| is_active | isActive |
| is_default | isDefault |

### Loyalty Tiers Table
| Database Column | API Field |
|-----------------|-----------|
| points_required | pointsRequired |
| discount_percentage | discountPercentage |
| points_multiplier | pointsMultiplier |

### Promotions Table
| Database Column | API Field |
|-----------------|-----------|
| discount_percentage | discountPercentage |
| discount_amount | discountAmount |
| start_date | startDate |
| end_date | endDate |
| is_active | isActive |
| min_purchase | minPurchase |
| max_discount | maxDiscount |
| usage_limit | usageLimit |
| usage_count | usageCount |
| tier_required | tierRequired |

### Overhead Expenses Table
| Database Column | API Field | Type Issue |
|-----------------|-----------|------------|
| start_date | startDate | DB: date, Schema: timestamp |
| end_date | endDate | DB: date, Schema: timestamp |
| is_active | isActive | |

## Issues Found
1. **Products**: Frontend expects `price` but API returns `defaultSalePrice`
2. **Expenses**: Date fields mismatch between date and timestamp types
3. **All tables**: Snake_case vs camelCase inconsistencies
4. **Repos layer**: Not consistently mapping between DB and API formats