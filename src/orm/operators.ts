export const Op = {
    eq: Symbol('='),
    ne: Symbol('<>'),
    gt: Symbol('>'),
    gte: Symbol('>='),
    lt: Symbol('<'),
    lte: Symbol('<='),
    like: Symbol('LIKE'),
    notLike: Symbol('NOT LIKE'),
    in: Symbol('IN'),
    notIn: Symbol('NOT IN'),
    between: Symbol('BETWEEN'),
    and: Symbol('AND'),
    or: Symbol('OR')
};